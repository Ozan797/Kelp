use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use uuid::Uuid;

use super::{SecretStore, keychain_error};
use crate::error::AppError;

pub const MAIN: &str = "secrets";
pub const NEXT: &str = "secrets.next";

type Secrets = HashMap<Uuid, String>;

fn parse(contents: &str) -> Result<Secrets, AppError> {
    serde_json::from_str(contents).map_err(|_| AppError::KeychainDamaged)
}

enum State {
    Unloaded,
    Loaded(Secrets),
    Damaged,
}

pub trait Vault: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, AppError>;
    fn add(&self, account: &str, contents: &str) -> Result<(), AppError>;
    fn remove(&self, account: &str) -> Result<(), AppError>;
    fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError>;
    fn remove_legacy(&self, id: &Uuid) -> Result<(), AppError>;
}

pub struct ProtectedStore<V: Vault> {
    vault: V,
    state: Mutex<State>,
    main_missing: AtomicBool,
}

impl<V: Vault> ProtectedStore<V> {
    pub fn new(vault: V) -> Self {
        Self {
            vault,
            state: Mutex::new(State::Unloaded),
            main_missing: AtomicBool::new(false),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, State>, AppError> {
        self.state
            .lock()
            .map_err(|_| keychain_error("the secret store is unavailable"))
    }

    fn load(&self) -> Result<Secrets, AppError> {
        let main = self.vault.read(MAIN)?;
        if let Some(Ok(secrets)) = main.as_deref().map(parse) {
            return Ok(secrets);
        }
        match self.vault.read(NEXT)? {
            Some(next) => {
                self.main_missing.store(true, Ordering::SeqCst);
                parse(&next)
            }
            None if main.is_some() => Err(AppError::KeychainDamaged),
            None => Ok(Secrets::new()),
        }
    }

    fn loaded<'a>(&self, state: &'a mut State) -> Result<&'a mut Secrets, AppError> {
        if matches!(state, State::Unloaded) {
            *state = match self.load() {
                Ok(secrets) => State::Loaded(secrets),
                Err(AppError::KeychainDamaged) => State::Damaged,
                Err(error) => return Err(error),
            };
        }
        match state {
            State::Loaded(secrets) => Ok(secrets),
            State::Unloaded | State::Damaged => Err(AppError::KeychainDamaged),
        }
    }

    fn working_copy(&self, state: &mut State) -> Result<Secrets, AppError> {
        match self.loaded(state) {
            Ok(secrets) => Ok(secrets.clone()),
            Err(AppError::KeychainDamaged) => Ok(Secrets::new()),
            Err(error) => Err(error),
        }
    }

    fn persist(&self, secrets: &Secrets) -> Result<(), AppError> {
        let contents = serde_json::to_string(secrets).map_err(keychain_error)?;
        if self.main_missing.load(Ordering::SeqCst) {
            self.vault.remove(MAIN)?;
            self.vault.add(MAIN, &contents)?;
            self.main_missing.store(false, Ordering::SeqCst);
            self.vault.remove(NEXT).ok();
            return Ok(());
        }
        self.vault.remove(NEXT)?;
        self.vault.add(NEXT, &contents)?;
        if let Err(error) = self.vault.remove(MAIN) {
            self.main_missing.store(true, Ordering::SeqCst);
            return Err(error);
        }
        if self.vault.add(MAIN, &contents).is_err() {
            self.main_missing.store(true, Ordering::SeqCst);
            return Ok(());
        }
        self.vault.remove(NEXT).ok();
        Ok(())
    }

    fn commit(&self, state: &mut State, next: Secrets) -> Result<(), AppError> {
        self.persist(&next)?;
        *state = State::Loaded(next);
        Ok(())
    }

    fn move_legacy(
        &self,
        state: &mut State,
        mut next: Secrets,
        id: &Uuid,
    ) -> Result<String, AppError> {
        let secret = self
            .vault
            .read_legacy(id)?
            .ok_or_else(|| keychain_error("no secret is saved for this connection"))?;
        next.insert(*id, secret.clone());
        if self.commit(state, next).is_ok() {
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
        self.vault.remove_legacy(id).ok();
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
        fail_add_once: Mutex<Option<&'static str>>,
        write_then_fail_once: Mutex<Option<&'static str>>,
        remove_then_fail_once: Mutex<Option<&'static str>>,
        fail_remove_legacy: Mutex<bool>,
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
            let mut once = self.fail_add_once.lock().unwrap();
            if *once == Some(account) {
                once.take();
                return Err(AppError::Keychain("disk full".into()));
            }
            drop(once);
            if *self.fail_add_to.lock().unwrap() == Some(account) {
                return Err(AppError::Keychain("disk full".into()));
            }
            if self.item(account).is_some() {
                return Err(AppError::Keychain("duplicate item".into()));
            }
            self.put(account, contents);
            let mut written_then_failed = self.write_then_fail_once.lock().unwrap();
            if *written_then_failed == Some(account) {
                written_then_failed.take();
                return Err(AppError::Keychain("timed out".into()));
            }
            Ok(())
        }
        fn remove(&self, account: &str) -> Result<(), AppError> {
            self.log(format!("remove {account}"));
            self.items.lock().unwrap().remove(account);
            let mut removed_then_failed = self.remove_then_fail_once.lock().unwrap();
            if *removed_then_failed == Some(account) {
                removed_then_failed.take();
                return Err(AppError::Keychain("timed out".into()));
            }
            Ok(())
        }
        fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError> {
            self.log("read_legacy".into());
            Ok(self.legacy.lock().unwrap().get(id).cloned())
        }
        fn remove_legacy(&self, id: &Uuid) -> Result<(), AppError> {
            self.log("remove_legacy".into());
            if *self.fail_remove_legacy.lock().unwrap() {
                return Err(AppError::Keychain("user denied".into()));
            }
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
    fn a_failed_main_add_still_saves_through_the_copy() {
        let id = Uuid::new_v4();
        let store = ProtectedStore::new(FakeVault::default());
        *store.vault.fail_add_once.lock().unwrap() = Some(MAIN);
        store.set(&id, "s3cret").unwrap();
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        assert!(store.vault.item(MAIN).is_none());
        let restarted = ProtectedStore::new(FakeVault::default());
        restarted.vault.put(NEXT, &store.vault.item(NEXT).unwrap());
        assert_eq!(restarted.get(&id).unwrap(), "s3cret");
    }

    #[test]
    fn the_write_after_a_failed_main_add_rebuilds_main_without_touching_the_copy_first() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let store = ProtectedStore::new(FakeVault::default());
        *store.vault.fail_add_once.lock().unwrap() = Some(MAIN);
        store.set(&a, "first").unwrap();
        store.set(&b, "second").unwrap();
        let map = written(&store.vault);
        assert_eq!(map[&a], "first");
        assert_eq!(map[&b], "second");
        assert!(store.vault.item(NEXT).is_none());
        assert_eq!(store.vault.count("add secrets.next"), 1);
    }

    #[test]
    fn a_failed_rebuild_of_main_keeps_the_copy() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let store = ProtectedStore::new(FakeVault::default());
        *store.vault.fail_add_once.lock().unwrap() = Some(MAIN);
        store.set(&a, "first").unwrap();
        *store.vault.fail_add_to.lock().unwrap() = Some(MAIN);
        assert!(store.set(&b, "second").is_err());
        let copy: HashMap<Uuid, String> =
            serde_json::from_str(&store.vault.item(NEXT).unwrap()).unwrap();
        assert_eq!(copy, HashMap::from([(a, "first".to_string())]));
        assert_eq!(store.get(&a).unwrap(), "first");
        assert!(store.get(&b).is_err());
    }

    #[test]
    fn a_main_item_written_despite_an_error_does_not_block_later_saves() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let store = ProtectedStore::new(FakeVault::default());
        *store.vault.write_then_fail_once.lock().unwrap() = Some(MAIN);
        store.set(&a, "first").unwrap();
        store.set(&b, "second").unwrap();
        let map = written(&store.vault);
        assert_eq!(map[&a], "first");
        assert_eq!(map[&b], "second");
        assert!(store.vault.item(NEXT).is_none());
    }

    #[test]
    fn writing_after_loading_from_next_adds_main_before_removing_next() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(NEXT, &saved(&[(id, "old")]));
        let store = ProtectedStore::new(vault);
        let other = Uuid::new_v4();
        store.set(&other, "new").unwrap();
        let writes: Vec<String> = store
            .vault
            .calls()
            .into_iter()
            .filter(|call| !call.starts_with("read"))
            .collect();
        assert_eq!(
            writes,
            ["remove secrets", "add secrets", "remove secrets.next"]
        );
        let map = written(&store.vault);
        assert_eq!(map[&id], "old");
        assert_eq!(map[&other], "new");
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
        *vault.fail_add_to.lock().unwrap() = Some(NEXT);
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
        *vault.fail_add_to.lock().unwrap() = Some(NEXT);
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
    fn a_main_removal_that_reports_failure_never_costs_the_only_copy() {
        let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let store = ProtectedStore::new(FakeVault::default());
        store.set(&a, "first").unwrap();
        *store.vault.remove_then_fail_once.lock().unwrap() = Some(MAIN);
        assert!(store.set(&b, "second").is_err());
        *store.vault.fail_add_to.lock().unwrap() = Some(NEXT);
        store.set(&c, "third").unwrap();
        let map = written(&store.vault);
        assert_eq!(map[&a], "first");
        assert_eq!(map[&c], "third");
        assert!(!map.contains_key(&b));
    }

    #[test]
    fn a_damaged_main_item_falls_back_to_a_good_copy() {
        let (id, other) = (Uuid::new_v4(), Uuid::new_v4());
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        vault.put(NEXT, &saved(&[(id, "s3cret")]));
        let store = ProtectedStore::new(vault);
        assert_eq!(store.get(&id).unwrap(), "s3cret");
        store.set(&other, "new").unwrap();
        let map = written(&store.vault);
        assert_eq!(map[&id], "s3cret");
        assert_eq!(map[&other], "new");
        assert!(store.vault.item(NEXT).is_none());
    }

    #[test]
    fn a_failed_legacy_removal_does_not_block_a_delete() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let vault = FakeVault::default();
        vault.put(MAIN, &saved(&[(a, "secret-a"), (b, "secret-b")]));
        *vault.fail_remove_legacy.lock().unwrap() = true;
        let store = ProtectedStore::new(vault);
        store.delete(&a).unwrap();
        assert!(!written(&store.vault).contains_key(&a));
    }

    #[test]
    fn a_damaged_item_is_read_once_per_launch() {
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        let store = ProtectedStore::new(vault);
        assert!(store.get(&Uuid::new_v4()).is_err());
        assert!(store.get(&Uuid::new_v4()).is_err());
        assert_eq!(store.vault.count("read secrets"), 1);
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
