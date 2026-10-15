use std::io::SeekFrom;
use std::ops::Range;
use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::timeout::TimeoutConfig;
use aws_sdk_s3::config::{
    BehaviorVersion, Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation,
};
use aws_sdk_s3::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_s3::operation::list_objects_v2::ListObjectsV2Output;
use aws_sdk_s3::primitives::{ByteStream, DateTimeFormat, Length};
use aws_sdk_s3::types::{
    CompletedMultipartUpload, CompletedPart as S3CompletedPart, Delete, Object, ObjectIdentifier,
};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use super::progress_body::with_progress;
use super::{
    CompletedPart, KeyPage, ListPage, ObjectInfo, ObjectMeta, PartTarget, ProgressFn,
    StorageProvider,
};
use crate::connection::ConnectionSettings;
use crate::error::AppError;

pub const MAX_SINGLE_UPLOAD: u64 = 5 * 1024 * 1024 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(60);

pub struct S3Provider {
    client: Client,
    transfer_client: Client,
}

fn quick_call_timeouts() -> TimeoutConfig {
    TimeoutConfig::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .operation_timeout(OPERATION_TIMEOUT)
        .build()
}

fn transfer_timeouts() -> TimeoutConfig {
    TimeoutConfig::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
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
            client: Client::from_conf(config.clone().timeout_config(quick_call_timeouts()).build()),
            transfer_client: Client::from_conf(config.timeout_config(transfer_timeouts()).build()),
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
        self.transfer_client
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

    async fn head(&self, bucket: &str, key: &str) -> Result<ObjectInfo, AppError> {
        let output = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        Ok(ObjectInfo {
            size: output
                .content_length()
                .and_then(|size| u64::try_from(size).ok())
                .unwrap_or(0),
            etag: output.e_tag().unwrap_or_default().to_string(),
        })
    }

    async fn start_multipart(&self, bucket: &str, key: &str) -> Result<String, AppError> {
        let output = self
            .client
            .create_multipart_upload()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        output
            .upload_id()
            .map(str::to_string)
            .ok_or_else(|| AppError::Provider("The provider didn't return an upload ID.".into()))
    }

    async fn put_part(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        path: &Path,
        offset: u64,
        len: u64,
        progress: ProgressFn,
    ) -> Result<String, AppError> {
        let file = ByteStream::read_from()
            .path(path)
            .offset(offset)
            .length(Length::Exact(len))
            .build()
            .await
            .map_err(|error| AppError::Io(error.to_string()))?;
        let body = ByteStream::new(with_progress(file.into_inner(), progress));
        let output = self
            .transfer_client
            .upload_part()
            .bucket(target.bucket)
            .key(target.key)
            .upload_id(target.upload_id)
            .part_number(part_number(number)?)
            .content_length(i64::try_from(len).map_err(|_| AppError::FileTooLarge)?)
            .body(body)
            .send()
            .await
            .map_err(|error| classify(error, target.bucket))?;
        Ok(output.e_tag().unwrap_or_default().to_string())
    }

    async fn complete_multipart(
        &self,
        target: &PartTarget<'_>,
        parts: &[CompletedPart],
    ) -> Result<(), AppError> {
        let mut sorted = parts.to_vec();
        sorted.sort_by_key(|part| part.number);
        let parts = sorted
            .iter()
            .map(|part| {
                Ok(S3CompletedPart::builder()
                    .part_number(part_number(part.number)?)
                    .e_tag(&part.etag)
                    .build())
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        self.client
            .complete_multipart_upload()
            .bucket(target.bucket)
            .key(target.key)
            .upload_id(target.upload_id)
            .multipart_upload(
                CompletedMultipartUpload::builder()
                    .set_parts(Some(parts))
                    .build(),
            )
            .send()
            .await
            .map_err(|error| classify(error, target.bucket))?;
        Ok(())
    }

    async fn abort_multipart(&self, target: &PartTarget<'_>) -> Result<(), AppError> {
        self.client
            .abort_multipart_upload()
            .bucket(target.bucket)
            .key(target.key)
            .upload_id(target.upload_id)
            .send()
            .await
            .map_err(|error| classify(error, target.bucket))?;
        Ok(())
    }

    async fn get_range(
        &self,
        bucket: &str,
        key: &str,
        etag: &str,
        range: Range<u64>,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError> {
        let mut output = self
            .transfer_client
            .get_object()
            .bucket(bucket)
            .key(key)
            .range(range_header(&range))
            .if_match(etag)
            .send()
            .await
            .map_err(|error| classify(error, bucket))?;
        let mut file = crate::transfers::paths::open_reserved(path).await?;
        file.seek(SeekFrom::Start(range.start)).await?;
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

fn part_number(number: u32) -> Result<i32, AppError> {
    i32::try_from(number).map_err(|_| AppError::FileTooLarge)
}

fn range_header(range: &Range<u64>) -> String {
    format!("bytes={}-{}", range.start, range.end.saturating_sub(1))
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
        objects: output.contents().iter().filter_map(object_meta).collect(),
        next_token: next_token(&output),
    }
}

fn object_meta(object: &Object) -> Option<ObjectMeta> {
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
        .filter_map(object_meta)
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
    use aws_sdk_s3::types::CommonPrefix;

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
        let found: Vec<(&str, u64)> = page
            .objects
            .iter()
            .map(|object| (object.key.as_str(), object.size))
            .collect();
        assert_eq!(found, vec![("photos/", 0), ("photos/2026/beach.jpg", 10)]);
        assert_eq!(page.next_token, Some("more".into()));
    }

    #[test]
    fn ranges_become_inclusive_byte_headers() {
        assert_eq!(range_header(&(0..8_388_608)), "bytes=0-8388607");
        assert_eq!(
            range_header(&(8_388_608..9_000_000)),
            "bytes=8388608-8999999"
        );
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
    fn quick_calls_time_out_but_transfers_only_limit_connecting() {
        let settings = ConnectionSettings {
            kind: crate::connection::ProviderKind::Hetzner,
            endpoint: None,
            region: "fsn1".into(),
            path_style: false,
            access_key_id: "AKIDEXAMPLE".into(),
        };
        let provider = S3Provider::new(&settings, "secret").unwrap();
        let quick = provider.client.config().timeout_config().unwrap();
        assert_eq!(quick.connect_timeout(), Some(Duration::from_secs(10)));
        assert_eq!(quick.read_timeout(), Some(Duration::from_secs(30)));
        assert_eq!(quick.operation_timeout(), Some(Duration::from_secs(60)));
        let transfer = provider.transfer_client.config().timeout_config().unwrap();
        assert_eq!(transfer.connect_timeout(), Some(Duration::from_secs(10)));
        assert_eq!(transfer.read_timeout(), None);
        assert_eq!(transfer.operation_timeout(), None);
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
