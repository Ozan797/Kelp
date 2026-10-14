use std::path::Path;

use async_trait::async_trait;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{
    BehaviorVersion, Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation,
};
use aws_sdk_s3::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_s3::operation::list_objects_v2::ListObjectsV2Output;
use aws_sdk_s3::primitives::{ByteStream, DateTimeFormat};
use aws_sdk_s3::types::{Delete, ObjectIdentifier};
use tokio::io::AsyncWriteExt;

use super::progress_body::with_progress;
use super::{KeyPage, ListPage, ObjectMeta, ProgressFn, StorageProvider};
use crate::connection::ConnectionSettings;
use crate::error::AppError;

pub const MAX_SINGLE_UPLOAD: u64 = 5 * 1024 * 1024 * 1024;

pub struct S3Provider {
    client: Client,
}

impl S3Provider {
    pub fn new(settings: &ConnectionSettings, secret_access_key: &str) -> Result<Self, AppError> {
        let endpoint = settings.endpoint_url()?;
        let credentials = Credentials::new(
            &settings.access_key_id,
            secret_access_key,
            None,
            None,
            "kelp",
        );

        let mut config = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(settings.signing_region()?))
            .credentials_provider(credentials)
            .force_path_style(settings.path_style)
            .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
            .response_checksum_validation(ResponseChecksumValidation::WhenRequired);
        if let Some(url) = endpoint {
            config = config.endpoint_url(url);
        }
        Ok(Self {
            client: Client::from_conf(config.build()),
        })
    }
}

#[async_trait]
impl StorageProvider for S3Provider {
    async fn list(
        &self,
        bucket: &str,
        prefix: &str,
        token: Option<String>,
    ) -> Result<ListPage, AppError> {
        let output = self
            .client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .delimiter("/")
            .set_continuation_token(token)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        Ok(to_list_page(output, prefix))
    }

    async fn list_buckets(&self) -> Result<Vec<String>, AppError> {
        let output = self
            .client
            .list_buckets()
            .send()
            .await
            .map_err(|error| classify(error, ""))?;
        Ok(output
            .buckets()
            .iter()
            .filter_map(|bucket| bucket.name().map(str::to_string))
            .collect())
    }

    async fn list_keys(
        &self,
        bucket: &str,
        prefix: &str,
        token: Option<String>,
    ) -> Result<KeyPage, AppError> {
        let output = self
            .client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .set_continuation_token(token)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        Ok(to_key_page(output))
    }

    async fn delete(&self, bucket: &str, keys: &[String]) -> Result<(), AppError> {
        for batch in keys.chunks(1000) {
            let objects = batch
                .iter()
                .map(|key| ObjectIdentifier::builder().key(key).build())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| AppError::Provider(error.to_string()))?;
            let delete = Delete::builder()
                .set_objects(Some(objects))
                .quiet(true)
                .build()
                .map_err(|error| AppError::Provider(error.to_string()))?;
            let output = self
                .client
                .delete_objects()
                .bucket(bucket)
                .delete(delete)
                .send()
                .await
                .map_err(|error| classify(error, bucket))?;
            if let Some(failed) = output.errors().first() {
                return Err(AppError::Provider(
                    failed
                        .message()
                        .unwrap_or("Some files couldn't be deleted.")
                        .to_string(),
                ));
            }
        }
        Ok(())
    }

    async fn create_folder(&self, bucket: &str, prefix: &str) -> Result<(), AppError> {
        self.client
            .put_object()
            .bucket(bucket)
            .key(prefix)
            .body(ByteStream::from_static(b""))
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        Ok(())
    }

    async fn put_file(
        &self,
        bucket: &str,
        key: &str,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        let size = tokio::fs::metadata(path).await?.len();
        if size > MAX_SINGLE_UPLOAD {
            return Err(AppError::FileTooLarge);
        }
        let file = ByteStream::from_path(path)
            .await
            .map_err(|error| AppError::Io(error.to_string()))?;
        let body = ByteStream::new(with_progress(file.into_inner(), progress));
        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .content_length(i64::try_from(size).map_err(|_| AppError::FileTooLarge)?)
            .body(body)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        Ok(())
    }

    async fn get_file(
        &self,
        bucket: &str,
        key: &str,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        let mut output = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        let mut file = crate::transfers::open_reserved(path).await?;
        let mut received = 0u64;
        while let Some(chunk) = output
            .body
            .try_next()
            .await
            .map_err(|_| AppError::Network)?
        {
            file.write_all(&chunk).await?;
            received += chunk.len() as u64;
            progress(received);
        }
        file.flush().await?;
        Ok(())
    }
}

fn classify<E: ProvideErrorMetadata, R>(error: SdkError<E, R>, bucket: &str) -> AppError {
    match &error {
        SdkError::DispatchFailure(_) | SdkError::TimeoutError(_) => AppError::Network,
        _ => AppError::from_provider_code(error.code(), error.message(), bucket),
    }
}

fn next_token(output: &ListObjectsV2Output) -> Option<String> {
    if output.is_truncated() == Some(true) {
        output.next_continuation_token().map(str::to_string)
    } else {
        None
    }
}

fn to_key_page(output: ListObjectsV2Output) -> KeyPage {
    KeyPage {
        keys: output
            .contents()
            .iter()
            .filter_map(|object| object.key().map(str::to_string))
            .collect(),
        next_token: next_token(&output),
    }
}

fn to_list_page(output: ListObjectsV2Output, prefix: &str) -> ListPage {
    let folders = output
        .common_prefixes()
        .iter()
        .filter_map(|folder| folder.prefix().map(str::to_string))
        .collect();

    let objects = output
        .contents()
        .iter()
        .filter(|object| object.key() != Some(prefix))
        .filter_map(|object| {
            Some(ObjectMeta {
                key: object.key()?.to_string(),
                size: object
                    .size()
                    .and_then(|size| u64::try_from(size).ok())
                    .unwrap_or(0),
                last_modified: object
                    .last_modified()
                    .and_then(|time| time.fmt(DateTimeFormat::DateTime).ok()),
            })
        })
        .collect();

    let next_token = next_token(&output);

    ListPage {
        folders,
        objects,
        next_token,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_s3::primitives::DateTime;
    use aws_sdk_s3::types::{CommonPrefix, Object};

    fn object(key: &str, size: i64) -> Object {
        Object::builder()
            .key(key)
            .size(size)
            .last_modified(DateTime::from_secs(1_792_000_000))
            .build()
    }

    #[test]
    fn splits_folders_and_objects() {
        let output = ListObjectsV2Output::builder()
            .common_prefixes(CommonPrefix::builder().prefix("photos/2026/").build())
            .contents(object("photos/beach.jpg", 2048))
            .build();
        let page = to_list_page(output, "photos/");
        assert_eq!(page.folders, vec!["photos/2026/".to_string()]);
        assert_eq!(
            page.objects,
            vec![ObjectMeta {
                key: "photos/beach.jpg".into(),
                size: 2048,
                last_modified: Some("2026-10-14T17:46:40Z".into()),
            }]
        );
        assert_eq!(page.next_token, None);
    }

    #[test]
    fn skips_the_folder_placeholder_object() {
        let output = ListObjectsV2Output::builder()
            .contents(object("photos/", 0))
            .contents(object("photos/beach.jpg", 1))
            .build();
        let keys: Vec<_> = to_list_page(output, "photos/")
            .objects
            .into_iter()
            .map(|o| o.key)
            .collect();
        assert_eq!(keys, vec!["photos/beach.jpg"]);
    }

    #[test]
    fn next_token_only_when_the_listing_is_truncated() {
        let more = ListObjectsV2Output::builder()
            .is_truncated(true)
            .next_continuation_token("page-2")
            .build();
        assert_eq!(to_list_page(more, "").next_token, Some("page-2".into()));

        let last = ListObjectsV2Output::builder()
            .is_truncated(false)
            .next_continuation_token("stale")
            .build();
        assert_eq!(to_list_page(last, "").next_token, None);
    }

    #[test]
    fn a_negative_or_missing_size_becomes_zero() {
        let output = ListObjectsV2Output::builder()
            .contents(object("odd.bin", -5))
            .contents(Object::builder().key("nosize.bin").build())
            .build();
        let sizes: Vec<_> = to_list_page(output, "")
            .objects
            .into_iter()
            .map(|o| o.size)
            .collect();
        assert_eq!(sizes, vec![0, 0]);
    }

    #[test]
    fn key_pages_list_every_key_including_folder_placeholders() {
        let output = ListObjectsV2Output::builder()
            .contents(object("photos/", 0))
            .contents(object("photos/2026/beach.jpg", 10))
            .is_truncated(true)
            .next_continuation_token("more")
            .build();
        let page = to_key_page(output);
        assert_eq!(page.keys, vec!["photos/", "photos/2026/beach.jpg"]);
        assert_eq!(page.next_token, Some("more".into()));
    }

    #[test]
    fn single_uploads_stop_at_five_gigabytes() {
        assert_eq!(MAX_SINGLE_UPLOAD, 5_368_709_120);
    }

    #[test]
    fn a_hetzner_client_builds_from_settings() {
        let settings = ConnectionSettings {
            kind: crate::connection::ProviderKind::Hetzner,
            endpoint: None,
            region: "fsn1".into(),
            path_style: false,
            access_key_id: "AKIDEXAMPLE".into(),
        };
        assert!(S3Provider::new(&settings, "secret").is_ok());
    }

    #[test]
    fn bad_settings_fail_before_any_request() {
        let settings = ConnectionSettings {
            kind: crate::connection::ProviderKind::R2,
            endpoint: None,
            region: "auto".into(),
            path_style: false,
            access_key_id: "AKIDEXAMPLE".into(),
        };
        assert!(matches!(
            S3Provider::new(&settings, "secret"),
            Err(AppError::InvalidSettings(_))
        ));
    }
}
