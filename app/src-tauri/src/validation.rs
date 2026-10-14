use serde::Serialize;

use crate::error::AppError;
use crate::providers::StorageProvider;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub buckets: Vec<String>,
    pub limited_to_bucket: bool,
}

pub async fn check_connection(
    provider: &dyn StorageProvider,
    bucket: Option<&str>,
) -> Result<CheckResult, AppError> {
    match provider.list_buckets().await {
        Ok(buckets) => Ok(CheckResult {
            buckets,
            limited_to_bucket: false,
        }),
        Err(AppError::AccessDenied) => {
            let bucket = bucket
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .ok_or(AppError::NotListable)?;
            provider.list(bucket, "", None).await?;
            Ok(CheckResult {
                buckets: vec![bucket.to_string()],
                limited_to_bucket: true,
            })
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use async_trait::async_trait;

    use super::*;
    use crate::providers::{KeyPage, ListPage, ProgressFn};

    struct FakeProvider {
        buckets: Result<Vec<String>, AppError>,
        listing: Result<ListPage, AppError>,
    }

    #[async_trait]
    impl StorageProvider for FakeProvider {
        async fn list(&self, _: &str, _: &str, _: Option<String>) -> Result<ListPage, AppError> {
            self.listing.clone()
        }
        async fn list_buckets(&self) -> Result<Vec<String>, AppError> {
            self.buckets.clone()
        }
        async fn list_keys(
            &self,
            _: &str,
            _: &str,
            _: Option<String>,
        ) -> Result<KeyPage, AppError> {
            unimplemented!()
        }
        async fn delete(&self, _: &str, _: &[String]) -> Result<(), AppError> {
            unimplemented!()
        }
        async fn create_folder(&self, _: &str, _: &str) -> Result<(), AppError> {
            unimplemented!()
        }
        async fn put_file(
            &self,
            _: &str,
            _: &str,
            _: &Path,
            _: ProgressFn,
        ) -> Result<(), AppError> {
            unimplemented!()
        }
        async fn get_file(
            &self,
            _: &str,
            _: &str,
            _: &Path,
            _: ProgressFn,
        ) -> Result<(), AppError> {
            unimplemented!()
        }
    }

    fn fake(
        buckets: Result<Vec<String>, AppError>,
        listing: Result<ListPage, AppError>,
    ) -> FakeProvider {
        FakeProvider { buckets, listing }
    }

    #[tokio::test]
    async fn keys_that_can_list_buckets_pass() {
        let provider = fake(
            Ok(vec!["media".into(), "backups".into()]),
            Ok(ListPage::default()),
        );
        let result = check_connection(&provider, None).await.unwrap();
        assert_eq!(
            result,
            CheckResult {
                buckets: vec!["media".into(), "backups".into()],
                limited_to_bucket: false
            }
        );
    }

    #[tokio::test]
    async fn wrong_keys_fail_with_bad_credentials() {
        let provider = fake(Err(AppError::BadCredentials), Ok(ListPage::default()));
        assert_eq!(
            check_connection(&provider, Some("media")).await,
            Err(AppError::BadCredentials)
        );
    }

    #[tokio::test]
    async fn keys_that_cannot_list_buckets_ask_for_one() {
        let provider = fake(Err(AppError::AccessDenied), Ok(ListPage::default()));
        assert_eq!(
            check_connection(&provider, None).await,
            Err(AppError::NotListable)
        );
        assert_eq!(
            check_connection(&provider, Some("   ")).await,
            Err(AppError::NotListable)
        );
    }

    #[tokio::test]
    async fn a_named_bucket_is_checked_instead() {
        let provider = fake(Err(AppError::AccessDenied), Ok(ListPage::default()));
        let result = check_connection(&provider, Some(" media ")).await.unwrap();
        assert_eq!(
            result,
            CheckResult {
                buckets: vec!["media".into()],
                limited_to_bucket: true
            }
        );
    }

    #[tokio::test]
    async fn a_named_bucket_that_fails_reports_why() {
        let provider = fake(
            Err(AppError::AccessDenied),
            Err(AppError::BucketNotFound("media".into())),
        );
        assert_eq!(
            check_connection(&provider, Some("media")).await,
            Err(AppError::BucketNotFound("media".into()))
        );
    }

    #[tokio::test]
    async fn network_errors_pass_through() {
        let provider = fake(Err(AppError::Network), Ok(ListPage::default()));
        assert_eq!(
            check_connection(&provider, None).await,
            Err(AppError::Network)
        );
    }
}
