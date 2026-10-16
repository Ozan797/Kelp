use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use uuid::Uuid;

use super::{SecretStore, keychain_error};
use crate::error::AppError;

pub const MAIN: &str = "secrets";
pub const NEXT: &str = "secrets.next";

type Secrets = HashMap<Uuid, String>;

pub trait Vault: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, AppError>;
    fn add(&self, account: &str, contents: &str) -> Result<(), AppError>;
    fn remove(&self, account: &str) -> Result<(), AppError>;
    fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError>;
    fn remove_legacy(&self, id: &Uuid) -> Result<(), AppError>;
}

pub struct ProtectedStore<V: Vault> {
    vault: V,
    secrets: Mutex<Option<Secrets>>,
}

impl<V: Vault> ProtectedStore<V> {
    pub fn new(vault: V) -> Self {
        Self {
            vault,
            secrets: Mutex::new(None),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Option<Secrets>>, AppError> {
        self.secrets
            .lock()
            .map_err(|_| keychain_error("the secret store is unavailable"))
    }

    fn load(&self) -> Result<Secrets, AppError> {
        let contents = match self.vault.read(MAIN)? {
            Some(contents) => Some(contents),
            None => self.vault.read(NEXT)?,
        };
        match contents {
            Some(contents) => {
                serde_json::from_str(&contents).map_err(|_| AppError::KeychainDamaged)
            }
            None => Ok(Secrets::new()),
        }
    }

    fn loaded<'a>(&self, slot: &'a mut Option<Secrets>) -> Result<&'a mut Secrets, AppError> {
        if slot.is_none() {
            *slot = Some(self.load()?);
        }
        Ok(slot.get_or_insert_with(Secrets::new))
    }

    fn working_copy(&self, slot: &mut Option<Secrets>) -> Result<Secrets, AppError> {
        match self.loaded(slot) {
            Ok(secrets) => Ok(secrets.clone()),
            Err(AppError::KeychainDamaged) => Ok(Secrets::new()),
            Err(error) => Err(error),
        }
    }

    fn persist(&self, secrets: &Secrets) -> Result<(), AppError> {
        let contents = serde_json::to_string(secrets).map_err(keychain_error)?;
        self.vault.remove(NEXT)?;
        self.vault.add(NEXT, &contents)?;
        self.vault.remove(MAIN)?;
        self.vault.add(MAIN, &contents)?;
        self.vault.remove(NEXT).ok();
        Ok(())
    }

    fn commit(&self, slot: &mut Option<Secrets>, next: Secrets) -> Result<(), AppError> {
        self.persist(&next)?;
        *slot = Some(next);
        Ok(())
    }

    fn move_legacy(
        &self,
        slot: &mut Option<Secrets>,
        mut next: Secrets,
        id: &Uuid,
    ) -> Result<String, AppError> {
        let secret = self
            .vault
            .read_legacy(id)?
            .ok_or_else(|| keychain_error("no secret is saved for this connection"))?;
        next.insert(*id, secret.clone());
        if self.commit(slot, next).is_ok() {
            self.vault.remove_legacy(id).ok();
        }
        Ok(secret)
    }
}

impl<V: Vault> SecretStore for ProtectedStore<V> {
    fn get(&self, id: &Uuid) -> Result<String, AppError> {
        let mut guard = self.lock()?;
        let secrets = self.loaded(&mut guard)?;
        if let Some(secret) = secrets.get(id) {
            return Ok(secret.clone());
        }
        let base = secrets.clone();
        self.move_legacy(&mut guard, base, id)
    }

    fn set(&self, id: &Uuid, secret: &str) -> Result<(), AppError> {
        let mut guard = self.lock()?;
        let mut next = self.working_copy(&mut guard)?;
        next.insert(*id, secret.to_string());
        self.commit(&mut guard, next)
    }

    fn delete(&self, id: &Uuid) -> Result<(), AppError> {
        let mut guard = self.lock()?;
        let mut next = self.working_copy(&mut guard)?;
        self.vault.remove_legacy(id)?;
        if next.remove(id).is_none() {
            return Ok(());
        }
        self.commit(&mut guard, next)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use uuid::Uuid;

    use super::*;
    use crate::error::AppError;
    use crate::secrets::SecretStore;

    #[derive(Default)]
    struct FakeVault {
        items: Mutex<HashMap<String, String>>,
        legacy: Mutex<HashMap<Uuid, String>>,
        calls: Mutex<Vec<String>>,
        fail_next_read: Mutex<Option<AppError>>,
        fail_add_to: Mutex<Option<&'static str>>,
    }

    impl FakeVault {
        fn log(&self, call: String) {
            self.calls.lock().unwrap().push(call);
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
        fn count(&self, call: &str) -> usize {
            self.calls().iter().filter(|logged| *logged == call).count()
        }
        fn item(&self, account: &str) -> Option<String> {
            self.items.lock().unwrap().get(account).cloned()
        }
        fn put(&self, account: &str, contents: &str) {
            self.items
                .lock()
                .unwrap()
                .insert(account.into(), contents.into());
        }
    }

    impl Vault for FakeVault {
        fn read(&self, account: &str) -> Result<Option<String>, AppError> {
            self.log(format!("read {account}"));
            if let Some(error) = self.fail_next_read.lock().unwrap().take() {
                return Err(error);
            }
            Ok(self.item(account))
        }
        fn add(&self, account: &str, contents: &str) -> Result<(), AppError> {
            self.log(format!("add {account}"));
            if *self.fail_add_to.lock().unwrap() == Some(account) {
                return Err(AppError::Keychain("disk full".into()));
            }
            self.put(account, contents);
            Ok(())
        }
        fn remove(&self, account: &str) -> Result<(), AppError> {
            self.log(format!("remove {account}"));
            self.items.lock().unwrap().remove(account);
            Ok(())
        }
        fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError> {
            self.log("read_legacy".into());
            Ok(self.legacy.lock().unwrap().get(id).cloned())
        }
        fn remove_legacy(&self, id: &Uuid) -> Result<(), AppError> {
            self.log("remove_legacy".into());
            self.legacy.lock().unwrap().remove(id);
            Ok(())
        }
    }

    fn saved(entries: &[(Uuid, &str)]) -> String {
        let map: HashMap<Uuid, String> = entries
            .iter()
            .map(|(id, secret)| (*id, secret.to_string()))
            .collect();
        serde_json::to_string(&map).unwrap()
    }

    fn written(vault: &FakeVault) -> HashMap<Uuid, String> {
        serde_json::from_str(&vault.item(MAIN).unwrap()).unwrap()
    }

    #[test]
    fn two_gets_read_the_item_once() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(MAIN, &saved(&[(id, "s3cret")]));
        let store = ProtectedStore::new(vault);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert_eq!(store.vault.count("read secrets"), 1);
    }

    #[test]
    fn two_threads_asking_at_once_read_once() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(MAIN, &saved(&[(id, "s3cret")]));
        let store = ProtectedStore::new(vault);
        std::thread::scope(|scope| {
            let first = scope.spawn(|| store.get(&id));
            let second = scope.spawn(|| store.get(&id));
            assert_eq!(first.join().unwrap().unwrap(), "s3cret");
            assert_eq!(second.join().unwrap().unwrap(), "s3cret");
        });
        assert_eq!(store.vault.count("read secrets"), 1);
    }

    #[test]
    fn a_cancelled_read_keeps_nothing_and_the_next_get_asks_again() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(MAIN, &saved(&[(id, "s3cret")]));
        *vault.fail_next_read.lock().unwrap() = Some(AppError::KeychainCancelled);
        let store = ProtectedStore::new(vault);
        assert_eq!(store.get(&id).unwrap_err(), AppError::KeychainCancelled);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert_eq!(store.vault.count("read secrets"), 2);
    }

    #[test]
    fn set_keeps_the_other_secrets() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let vault = FakeVault::default();
        vault.put(MAIN, &saved(&[(a, "secret-a")]));
        let store = ProtectedStore::new(vault);
        store.set(&b, "secret-b").unwrap();
        let map = written(&store.vault);
        assert_eq!(map[&a], "secret-a");
        assert_eq!(map[&b], "secret-b");
    }

    #[test]
    fn a_write_adds_the_copy_before_touching_the_main_item() {
        let store = ProtectedStore::new(FakeVault::default());
        store.set(&Uuid::new_v4(), "s3cret").unwrap();
        let writes: Vec<String> = store
            .vault
            .calls()
            .into_iter()
            .filter(|call| !call.starts_with("read"))
            .collect();
        assert_eq!(
            writes,
            [
                "remove secrets.next",
                "add secrets.next",
                "remove secrets",
                "add secrets",
                "remove secrets.next",
            ]
        );
        assert!(store.vault.item(NEXT).is_none());
    }

    #[test]
    fn a_write_cut_off_half_way_is_recovered_from_next() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(NEXT, &saved(&[(id, "s3cret")]));
        let store = ProtectedStore::new(vault);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
    }

    #[test]
    fn a_failed_write_leaves_memory_unchanged() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        *vault.fail_add_to.lock().unwrap() = Some(MAIN);
        let store = ProtectedStore::new(vault);
        assert!(store.set(&id, "s3cret").is_err());
        assert!(store.get(&id).is_err());
    }

    #[test]
    fn delete_keeps_the_others_and_removes_the_legacy_item() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let vault = FakeVault::default();
        vault.put(MAIN, &saved(&[(a, "secret-a"), (b, "secret-b")]));
        vault.legacy.lock().unwrap().insert(a, "old-a".into());
        let store = ProtectedStore::new(vault);
        store.delete(&a).unwrap();
        let map = written(&store.vault);
        assert!(!map.contains_key(&a));
        assert_eq!(map[&b], "secret-b");
        assert!(store.vault.legacy.lock().unwrap().is_empty());
    }

    #[test]
    fn deleting_a_missing_id_writes_nothing() {
        let store = ProtectedStore::new(FakeVault::default());
        store.delete(&Uuid::new_v4()).unwrap();
        assert_eq!(store.vault.count("add secrets"), 0);
    }

    #[test]
    fn a_legacy_secret_is_moved_then_the_old_item_removed() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.legacy.lock().unwrap().insert(id, "s3cret".into());
        let store = ProtectedStore::new(vault);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert_eq!(written(&store.vault)[&id], "s3cret");
        let calls = store.vault.calls();
        let added = calls.iter().position(|call| call == "add secrets").unwrap();
        let removed = calls
            .iter()
            .position(|call| call == "remove_legacy")
            .unwrap();
        assert!(added < removed);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert_eq!(store.vault.count("read_legacy"), 1);
    }

    #[test]
    fn a_failed_move_still_returns_the_secret_and_keeps_the_legacy_item() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.legacy.lock().unwrap().insert(id, "s3cret".into());
        *vault.fail_add_to.lock().unwrap() = Some(MAIN);
        let store = ProtectedStore::new(vault);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert!(store.vault.legacy.lock().unwrap().contains_key(&id));
    }

    #[test]
    fn a_missing_secret_is_the_usual_keychain_error() {
        let store = ProtectedStore::new(FakeVault::default());
        assert!(matches!(
            store.get(&Uuid::new_v4()),
            Err(AppError::Keychain(_))
        ));
    }

    #[test]
    fn a_damaged_item_is_reported_and_not_overwritten_by_a_get() {
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        let store = ProtectedStore::new(vault);
        assert_eq!(
            store.get(&Uuid::new_v4()).unwrap_err(),
            AppError::KeychainDamaged
        );
        assert_eq!(store.vault.item(MAIN).unwrap(), "not json");
    }

    #[test]
    fn deleting_a_missing_id_from_a_damaged_item_keeps_it_reported() {
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        let store = ProtectedStore::new(vault);
        store.delete(&Uuid::new_v4()).unwrap();
        assert_eq!(
            store.get(&Uuid::new_v4()).unwrap_err(),
            AppError::KeychainDamaged
        );
    }

    #[test]
    fn a_failed_save_over_a_damaged_item_keeps_it_reported() {
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        *vault.fail_add_to.lock().unwrap() = Some(NEXT);
        let store = ProtectedStore::new(vault);
        assert!(store.set(&Uuid::new_v4(), "s3cret").is_err());
        assert_eq!(
            store.get(&Uuid::new_v4()).unwrap_err(),
            AppError::KeychainDamaged
        );
    }

    #[test]
    fn saving_over_a_damaged_item_starts_fresh() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        let store = ProtectedStore::new(vault);
        store.set(&id, "s3cret").unwrap();
        assert_eq!(
            written(&store.vault),
            HashMap::from([(id, "s3cret".to_string())])
        );
    }

    #[test]
    fn unusual_secrets_round_trip() {
        let id = Uuid::new_v4();
        let secret = "quote\" back\\slash ünïcødé 🔑";
        let store = ProtectedStore::new(FakeVault::default());
        store.set(&id, secret).unwrap();
        let reloaded = ProtectedStore::new(FakeVault::default());
        reloaded.vault.put(MAIN, &store.vault.item(MAIN).unwrap());
        assert_eq!(reloaded.get(&id).unwrap(), secret);
    }

    #[test]
    fn errors_never_contain_the_secret() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(MAIN, "{\"broken\": \"hunter2-secret");
        let store = ProtectedStore::new(vault);
        let message = store.get(&id).unwrap_err().to_string();
        assert!(!message.contains("hunter2"), "{message}");
    }
}
