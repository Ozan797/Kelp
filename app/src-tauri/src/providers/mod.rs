pub mod progress_body;
pub mod s3;

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;

use crate::error::AppError;

pub type ProgressFn = Arc<dyn Fn(u64) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectMeta {
    pub key: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    pub folders: Vec<String>,
    pub objects: Vec<ObjectMeta>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPage {
    pub keys: Vec<String>,
    pub next_token: Option<String>,
}

#[async_trait]
pub trait StorageProvider: Send + Sync {
    async fn list(
        &self,
        bucket: &str,
        prefix: &str,
        token: Option<String>,
    ) -> Result<ListPage, AppError>;
    async fn list_buckets(&self) -> Result<Vec<String>, AppError>;
    async fn list_keys(
        &self,
        bucket: &str,
        prefix: &str,
        token: Option<String>,
    ) -> Result<KeyPage, AppError>;
    async fn delete(&self, bucket: &str, keys: &[String]) -> Result<(), AppError>;
    async fn create_folder(&self, bucket: &str, prefix: &str) -> Result<(), AppError>;
    async fn put_file(
        &self,
        bucket: &str,
        key: &str,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError>;
    async fn get_file(
        &self,
        bucket: &str,
        key: &str,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError>;
}
