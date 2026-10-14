use std::path::Path;

use async_trait::async_trait;

use crate::error::AppError;
use crate::providers::{KeyPage, ListPage, ProgressFn, StorageProvider};

pub struct FakeProvider {
    buckets: Result<Vec<String>, AppError>,
    listing: Result<ListPage, AppError>,
    keys: Vec<String>,
    deleted: std::sync::Mutex<Vec<String>>,
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
        prefix: &str,
        _: Option<String>,
    ) -> Result<KeyPage, AppError> {
        Ok(KeyPage {
            keys: self
                .keys
                .iter()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect(),
            next_token: None,
        })
    }
    async fn delete(&self, _: &str, keys: &[String]) -> Result<(), AppError> {
        if let Ok(mut deleted) = self.deleted.lock() {
            deleted.extend(keys.iter().cloned());
        }
        Ok(())
    }
    async fn create_folder(&self, _: &str, _: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn put_file(&self, _: &str, _: &str, _: &Path, _: ProgressFn) -> Result<(), AppError> {
        unimplemented!()
    }
    async fn get_file(&self, _: &str, _: &str, _: &Path, _: ProgressFn) -> Result<(), AppError> {
        unimplemented!()
    }
}

impl FakeProvider {
    pub fn new(
        buckets: Result<Vec<String>, AppError>,
        listing: Result<ListPage, AppError>,
    ) -> Self {
        Self {
            buckets,
            listing,
            keys: Vec::new(),
            deleted: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn with_keys(mut self, keys: Vec<String>) -> Self {
        self.keys = keys;
        self
    }

    pub fn deleted(&self) -> Vec<String> {
        self.deleted
            .lock()
            .map(|deleted| deleted.clone())
            .unwrap_or_default()
    }
}
