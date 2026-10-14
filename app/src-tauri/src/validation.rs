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
    use super::*;
    use crate::providers::ListPage;
    use crate::testing::FakeProvider;

    #[tokio::test]
    async fn keys_that_can_list_buckets_pass() {
        let provider = FakeProvider::new(
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
        let provider = FakeProvider::new(Err(AppError::BadCredentials), Ok(ListPage::default()));
        assert_eq!(
            check_connection(&provider, Some("media")).await,
            Err(AppError::BadCredentials)
        );
    }

    #[tokio::test]
    async fn keys_that_cannot_list_buckets_ask_for_one() {
        let provider = FakeProvider::new(Err(AppError::AccessDenied), Ok(ListPage::default()));
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
        let provider = FakeProvider::new(Err(AppError::AccessDenied), Ok(ListPage::default()));
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
        let provider = FakeProvider::new(
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
        let provider = FakeProvider::new(Err(AppError::Network), Ok(ListPage::default()));
        assert_eq!(
            check_connection(&provider, None).await,
            Err(AppError::Network)
        );
    }
}
