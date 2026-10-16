use std::collections::HashMap;
use std::sync::Mutex;

use uuid::Uuid;

use crate::error::AppError;

pub mod protected;

pub const SERVICE: &str = "dev.ozanai.kelp";

pub trait SecretStore: Send + Sync {
    fn get(&self, id: &Uuid) -> Result<String, AppError>;
    fn set(&self, id: &Uuid, secret: &str) -> Result<(), AppError>;
    fn delete(&self, id: &Uuid) -> Result<(), AppError>;
}

pub struct KeychainStore;

#[derive(Default)]
pub struct MemoryStore {
    secrets: Mutex<HashMap<Uuid, String>>,
}

pub fn keychain_error(error: impl std::fmt::Display) -> AppError {
    AppError::Keychain(error.to_string())
}

impl KeychainStore {
    fn entry(id: &Uuid) -> Result<keyring::Entry, AppError> {
        keyring::Entry::new(SERVICE, &id.to_string()).map_err(keychain_error)
    }
}

impl SecretStore for KeychainStore {
    fn get(&self, id: &Uuid) -> Result<String, AppError> {
        Self::entry(id)?.get_password().map_err(keychain_error)
    }

    fn set(&self, id: &Uuid, secret: &str) -> Result<(), AppError> {
        Self::entry(id)?
            .set_password(secret)
            .map_err(keychain_error)
    }

    fn delete(&self, id: &Uuid) -> Result<(), AppError> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keychain_error(error)),
        }
    }
}

impl MemoryStore {
    fn secrets(&self) -> Result<std::sync::MutexGuard<'_, HashMap<Uuid, String>>, AppError> {
        self.secrets
            .lock()
            .map_err(|_| keychain_error("the secret store is unavailable"))
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, id: &Uuid) -> Result<String, AppError> {
        self.secrets()?
            .get(id)
            .cloned()
            .ok_or_else(|| keychain_error("no secret is saved for this connection"))
    }

    fn set(&self, id: &Uuid, secret: &str) -> Result<(), AppError> {
        self.secrets()?.insert(*id, secret.to_string());
        Ok(())
    }

    fn delete(&self, id: &Uuid) -> Result<(), AppError> {
        self.secrets()?.remove(id);
        Ok(())
    }
}

#[cfg(test)]
impl MemoryStore {
    pub fn count(&self) -> usize {
        self.secrets
            .lock()
            .map(|secrets| secrets.len())
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_keeps_secrets_per_connection() {
        let store = MemoryStore::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        store.set(&a, "secret-a").unwrap();
        store.set(&b, "secret-b").unwrap();
        assert_eq!(store.get(&a).unwrap(), "secret-a");
        assert_eq!(store.get(&b).unwrap(), "secret-b");
    }

    #[test]
    fn a_missing_secret_is_a_keychain_error() {
        let error = MemoryStore::default().get(&Uuid::new_v4()).unwrap_err();
        assert!(matches!(error, AppError::Keychain(_)));
    }

    #[test]
    fn deleting_removes_and_is_safe_to_repeat() {
        let store = MemoryStore::default();
        let id = Uuid::new_v4();
        store.set(&id, "secret").unwrap();
        store.delete(&id).unwrap();
        store.delete(&id).unwrap();
        assert!(store.get(&id).is_err());
    }
}
