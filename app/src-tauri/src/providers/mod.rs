pub mod s3;

use async_trait::async_trait;
use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObjectMeta {
    pub key: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ListPage {
    pub folders: Vec<String>,
    pub objects: Vec<ObjectMeta>,
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
}
