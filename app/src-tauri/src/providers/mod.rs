//! Storage providers. This is the only module that knows about S3 (CLAUDE.md architecture rules);
//! everything else talks to the `StorageProvider` trait.

pub mod s3;

use async_trait::async_trait;
use serde::Serialize;

use crate::error::AppError;

/// One object (file) in a listing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObjectMeta {
    /// The full key, for example `photos/2026/beach.jpg`.
    pub key: String,
    pub size: u64,
    /// RFC 3339 time, for example `2026-10-14T18:02:11Z`, if the provider sent one.
    pub last_modified: Option<String>,
}

/// One page of a folder listing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ListPage {
    /// Sub-folders directly inside the listed folder, each ending in `/` (from S3 "common prefixes").
    pub folders: Vec<String>,
    /// Objects directly inside the listed folder.
    pub objects: Vec<ObjectMeta>,
    /// Pass this to `list` to get the next page. `None` means this was the last page.
    pub next_token: Option<String>,
}

/// What every storage provider can do. Only listing for now; head, get, put and delete follow in M1.
///
/// `Send + Sync` lets one provider be shared safely between threads (the app will keep it in an `Arc`).
/// `#[async_trait]` is needed because the app stores providers as `dyn StorageProvider`, and Rust can't
/// put plain `async fn`s in a trait used that way yet.
#[async_trait]
pub trait StorageProvider: Send + Sync {
    /// Lists one folder: the objects directly under `prefix` and its sub-folders, up to 1000 per page.
    /// Use `""` for the top of the bucket. Pass the previous page's `next_token` to continue.
    async fn list(
        &self,
        bucket: &str,
        prefix: &str,
        token: Option<String>,
    ) -> Result<ListPage, AppError>;
}
