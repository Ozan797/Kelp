pub mod progress_body;
pub mod s3;

use std::ops::Range;
use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const MAX_OBJECT_SIZE: u64 = 5 * 1024 * 1024 * 1024 * 1024;

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
    pub objects: Vec<ObjectMeta>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectInfo {
    pub size: u64,
    pub etag: String,
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct ObjectRef<'a> {
    pub bucket: &'a str,
    pub key: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct PartTarget<'a> {
    pub bucket: &'a str,
    pub key: &'a str,
    pub upload_id: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedPart {
    pub number: u32,
    pub etag: String,
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
    async fn head(&self, bucket: &str, key: &str) -> Result<ObjectInfo, AppError>;
    async fn start_multipart(
        &self,
        bucket: &str,
        key: &str,
        content_type: Option<&str>,
    ) -> Result<String, AppError>;
    async fn put_part(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        path: &Path,
        offset: u64,
        len: u64,
        progress: ProgressFn,
    ) -> Result<String, AppError>;
    async fn complete_multipart(
        &self,
        target: &PartTarget<'_>,
        parts: &[CompletedPart],
    ) -> Result<(), AppError>;
    async fn abort_multipart(&self, target: &PartTarget<'_>) -> Result<(), AppError>;
    async fn copy_object(
        &self,
        from: &ObjectRef<'_>,
        to: &ObjectRef<'_>,
        etag: &str,
    ) -> Result<(), AppError>;
    async fn copy_part(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        from: &ObjectRef<'_>,
        range: Range<u64>,
        etag: &str,
    ) -> Result<String, AppError>;
    async fn put_part_bytes(
        &self,
        target: &PartTarget<'_>,
        number: u32,
        bytes: bytes::Bytes,
        progress: ProgressFn,
    ) -> Result<String, AppError>;
    async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        bytes: bytes::Bytes,
        content_type: Option<&str>,
        progress: ProgressFn,
    ) -> Result<(), AppError>;
    async fn get_bytes(
        &self,
        bucket: &str,
        key: &str,
        etag: &str,
        range: Range<u64>,
    ) -> Result<bytes::Bytes, AppError>;
    async fn get_range(
        &self,
        bucket: &str,
        key: &str,
        etag: &str,
        range: Range<u64>,
        path: &Path,
        progress: ProgressFn,
    ) -> Result<(), AppError>;
}
