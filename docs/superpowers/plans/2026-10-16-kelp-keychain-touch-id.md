# Keychain with Touch ID and local signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release builds keep every secret in one data-protection Keychain item unlocked by Touch ID once per launch; dev builds are signed so "Always Allow" sticks; no personal details enter the repo.

**Architecture:** A new `ProtectedStore` implements the existing `SecretStore` trait on top of a small `Vault` trait (raw Keychain calls), so all its logic is unit-tested with a fake. `lib.rs` picks `ProtectedStore` in release and today's `KeychainStore` in debug. Keychain calls move off tokio workers through `spawn_blocking` helpers on `AppState`. Signing is config plus two small scripts.

**Tech Stack:** Rust 2024, Tauri 2, tokio, `security-framework` 3 (new direct dependency), `keyring` 3, Node (scripts), shell.

**Spec:** `docs/superpowers/specs/2026-10-16-kelp-keychain-touch-id-design.md`

## Global Constraints

- No comments, doc comments or file headers in new or changed code (CLAUDE.md).
- No `unwrap()`/`expect()` outside tests; propagate with `?`.
- `cargo fmt`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass after every task (run in `app/src-tauri`).
- `cd app && npm run typecheck && npm test` pass after any task touching `app/`.
- Never put a secret in an error message, log or test fixture that looks real; tests use strings like `"s3cret"`.
- Never commit the Team ID, the signing identity name, an email, `Kelp.entitlements` or `Kelp.provisionprofile`.
- Commit messages: plain sentences, no `Co-Authored-By` line. Never push.
- Keychain service name stays `dev.ozanai.kelp`. Protected item accounts: `secrets` and `secrets.next`.
- Error texts, verbatim:
  - `KeychainCancelled`: `Kelp couldn't unlock your keys because Touch ID was cancelled. Open the connection again to try once more.`
  - `KeychainNotSigned`: `This copy of Kelp isn't signed to use the Keychain. Install it from the .dmg, or run it with tauri dev while developing.`
  - `KeychainDamaged`: `Kelp's saved keys can't be read. Re-enter the secret key for each connection.`
  - Team ID missing: `Set KELP_TEAM_ID to your Apple Team ID (developer.apple.com → Membership details).`

## Review Focus

1. Several tabs open at once on launch: exactly one Touch ID prompt, not one per tab — Task 3 `two_threads_asking_at_once_read_once`.
2. App quits or crashes half way through a write: the next launch still finds every secret — Task 3 `a_write_cut_off_half_way_is_recovered_from_next`.
3. Touch ID cancelled while saving a connection: nothing is saved and the message is shown — Task 2 `a_cancelled_touch_id_prompt_saves_nothing`.
4. A secret with quotes, backslashes or non-ASCII text: comes back byte-identical — Task 3 `unusual_secrets_round_trip`.
5. Moving an old secret fails at the write: the connection still opens and the old item is kept — Task 3 `a_failed_move_still_returns_the_secret_and_keeps_the_legacy_item`.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `app/src-tauri/src/error.rs` | modify | three new Keychain error variants |
| `app/src/lib/tauri.ts` | modify | the three new `ErrorKind`s |
| `app/src-tauri/src/state.rs` | modify | `Arc<dyn SecretStore>`, async `secret`/`set_secret`/`delete_secret` |
| `app/src-tauri/src/commands/connections.rs` | modify | use the async helpers |
| `app/src-tauri/src/testing.rs` | modify | `Arc::new` instead of `Box::new` |
| `app/src-tauri/src/secrets.rs` → `secrets/mod.rs` | move + modify | trait, `KeychainStore`, `MemoryStore`, declares submodules |
| `app/src-tauri/src/secrets/protected.rs` | create | `Vault` trait, `ProtectedStore`, unit tests with `FakeVault` |
| `app/src-tauri/src/secrets/vault.rs` | create | `KeychainVault`, the real Keychain calls |
| `app/src-tauri/src/lib.rs` | modify | pick the store by build type |
| `app/src-tauri/Cargo.toml` | modify | `security-framework` dependency |
| `app/src-tauri/Kelp.entitlements.template` | create | entitlements with `__TEAM_ID__` |
| `app/scripts/entitlements.mjs` (+ `.test.mjs`) | create | fills the Team ID before bundling |
| `app/src-tauri/tauri.conf.json` | modify | `beforeBundleCommand`, entitlements, provisioning profile |
| `app/package.json` | modify | run the node test in `npm test` |
| `app/src-tauri/.cargo/config.toml` | create | Cargo runner |
| `app/src-tauri/scripts/dev-sign.sh` | create | signs dev binaries |
| `README.md`, `SPEC.md`, `CLAUDE.md`, `docs/STATUS.md` | modify | docs |

---

### Task 1: Keychain error variants

**Files:**
- Modify: `app/src-tauri/src/error.rs`
- Modify: `app/src/lib/tauri.ts:41-57`

**Interfaces:**
- Produces: `AppError::KeychainCancelled`, `AppError::KeychainNotSigned`, `AppError::KeychainDamaged` (unit variants), kinds `"keychainCancelled"`, `"keychainNotSigned"`, `"keychainDamaged"`.

- [ ] **Step 1: Write the failing tests**

In `error.rs`'s `tests` module, add three rows to the `cases` array in `every_variant_has_a_camel_case_kind`:

```rust
            (AppError::KeychainCancelled, "keychainCancelled"),
            (AppError::KeychainNotSigned, "keychainNotSigned"),
            (AppError::KeychainDamaged, "keychainDamaged"),
```

and add this test:

```rust
    #[test]
    fn keychain_messages_say_what_to_do_without_the_generic_wrapper() {
        assert_eq!(
            AppError::KeychainCancelled.to_string(),
            "Kelp couldn't unlock your keys because Touch ID was cancelled. Open the connection again to try once more."
        );
        assert_eq!(
            AppError::KeychainNotSigned.to_string(),
            "This copy of Kelp isn't signed to use the Keychain. Install it from the .dmg, or run it with tauri dev while developing."
        );
        assert_eq!(
            AppError::KeychainDamaged.to_string(),
            "Kelp's saved keys can't be read. Re-enter the secret key for each connection."
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib error::` (in `app/src-tauri`)
Expected: compile error, `no variant named KeychainCancelled`.

- [ ] **Step 3: Implement**

In the `AppError` enum, after `Keychain(String),`:

```rust
    #[error(
        "Kelp couldn't unlock your keys because Touch ID was cancelled. Open the connection again to try once more."
    )]
    KeychainCancelled,

    #[error(
        "This copy of Kelp isn't signed to use the Keychain. Install it from the .dmg, or run it with tauri dev while developing."
    )]
    KeychainNotSigned,

    #[error("Kelp's saved keys can't be read. Re-enter the secret key for each connection.")]
    KeychainDamaged,
```

In `kind()`, after `Self::Keychain(_) => "keychain",`:

```rust
            Self::KeychainCancelled => "keychainCancelled",
            Self::KeychainNotSigned => "keychainNotSigned",
            Self::KeychainDamaged => "keychainDamaged",
```

In `app/src/lib/tauri.ts`, after `  | "keychain"`:

```ts
  | "keychainCancelled"
  | "keychainNotSigned"
  | "keychainDamaged"
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib error:: && cargo clippy --all-targets -- -D warnings` then `cd ../ && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/error.rs app/src/lib/tauri.ts
git commit -m "Add Keychain errors for a cancelled prompt, an unsigned build and a damaged item"
```

---

### Task 2: Keep Keychain calls off the async workers

A Touch ID prompt blocks the calling thread until the user answers. `tokio::task::spawn_blocking` runs a blocking call on tokio's separate pool for slow work, so listings and transfers keep running. It needs a `'static` closure, so the store becomes an `Arc` (a shared, reference-counted pointer) that each call clones.

**Files:**
- Modify: `app/src-tauri/src/state.rs`
- Modify: `app/src-tauri/src/commands/connections.rs`
- Modify: `app/src-tauri/src/testing.rs:437-440,474-478`
- Modify: `app/src-tauri/src/lib.rs:95-99`

**Interfaces:**
- Consumes: `AppError::KeychainCancelled` (Task 1).
- Produces:
  - `AppState.secrets: Arc<dyn SecretStore>`
  - `AppState::new(store: ProfileStore, secrets: Arc<dyn SecretStore>, connect: Connect) -> Self`
  - `pub async fn secret(&self, id: Uuid) -> Result<String, AppError>`
  - `pub async fn set_secret(&self, id: Uuid, secret: String) -> Result<(), AppError>`
  - `pub async fn delete_secret(&self, id: Uuid) -> Result<(), AppError>`

- [ ] **Step 1: Write the failing tests**

At the end of `state.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    fn state() -> AppState {
        let dir = std::env::temp_dir().join(format!("kelp-state-{}", Uuid::new_v4()));
        AppState::new(
            ProfileStore::new(&dir),
            Arc::new(MemoryStore::default()),
            real_connect(),
        )
    }

    #[tokio::test]
    async fn secrets_round_trip_through_the_blocking_helpers() {
        let state = state();
        let id = Uuid::new_v4();
        state.set_secret(id, "s3cret".into()).await.unwrap();
        assert_eq!(state.secret(id).await.unwrap(), "s3cret");
        state.delete_secret(id).await.unwrap();
        assert!(state.secret(id).await.is_err());
    }
}
```

In `connections.rs` tests, add next to `SharedStore`:

```rust
    struct CancellingStore;

    impl SecretStore for CancellingStore {
        fn get(&self, _: &Uuid) -> Result<String, AppError> {
            Err(AppError::KeychainCancelled)
        }
        fn set(&self, _: &Uuid, _: &str) -> Result<(), AppError> {
            Err(AppError::KeychainCancelled)
        }
        fn delete(&self, _: &Uuid) -> Result<(), AppError> {
            Err(AppError::KeychainCancelled)
        }
    }

    #[tokio::test]
    async fn a_cancelled_touch_id_prompt_saves_nothing() {
        let dir = temp_dir();
        let connect: crate::state::Connect = Box::new(|_, _| {
            Ok(Arc::new(FakeProvider::new(
                Ok(vec!["media".into()]),
                Ok(ListPage::default()),
            )))
        });
        let state = AppState::new(ProfileStore::new(&dir), Arc::new(CancellingStore), connect);
        let error = save(&state, draft("media", Some("s3cret")))
            .await
            .unwrap_err();
        assert_eq!(error, AppError::KeychainCancelled);
        assert!(list(&state).await.unwrap().is_empty());
        assert!(!dir.join("connections.json").exists());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib state:: commands::connections::`
Expected: compile errors (`no method named set_secret`, `expected Box<dyn SecretStore>, found Arc<CancellingStore>`).

- [ ] **Step 3: Implement**

`state.rs`: change the field and constructor parameter to `Arc<dyn SecretStore>`, and add to `impl AppState`:

```rust
    async fn with_secrets<T: Send + 'static>(
        &self,
        work: impl FnOnce(&dyn SecretStore) -> Result<T, AppError> + Send + 'static,
    ) -> Result<T, AppError> {
        let secrets = self.secrets.clone();
        tokio::task::spawn_blocking(move || work(secrets.as_ref()))
            .await
            .map_err(|_| AppError::Keychain("the secret store is unavailable".into()))?
    }

    pub async fn secret(&self, id: Uuid) -> Result<String, AppError> {
        self.with_secrets(move |secrets| secrets.get(&id)).await
    }

    pub async fn set_secret(&self, id: Uuid, secret: String) -> Result<(), AppError> {
        self.with_secrets(move |secrets| secrets.set(&id, &secret)).await
    }

    pub async fn delete_secret(&self, id: Uuid) -> Result<(), AppError> {
        self.with_secrets(move |secrets| secrets.delete(&id)).await
    }
```

In `provider`, replace `let secret = self.secrets.get(&id)?;` with `let secret = self.secret(id).await?;`.

`connections.rs`:

```rust
async fn secret_for(state: &AppState, draft: &ConnectionDraft) -> Result<String, AppError> {
    let typed = draft
        .secret
        .as_deref()
        .map(str::trim)
        .filter(|secret| !secret.is_empty());
    match (typed, draft.id) {
        (Some(secret), _) => Ok(secret.to_string()),
        (None, Some(id)) => state.secret(id).await,
        (None, None) => Err(AppError::InvalidSettings("Enter the secret key.".into())),
    }
}
```

Both callers (`test` and `save`) become `secret_for(state, draft).await?` / `secret_for(state, &draft).await?`. In `save`, replace the secret block with:

```rust
    let previous_secret = state.secret(id).await.ok();
    state.set_secret(id, secret).await?;
    if let Err(error) = state.store.save(&next) {
        match previous_secret {
            Some(previous) => state.set_secret(id, previous).await.ok(),
            None => state.delete_secret(id).await.ok(),
        };
        return Err(error);
    }
```

The `profiles` lock is a `tokio::sync::Mutex`, so holding it across these `.await`s is allowed (CLAUDE.md). In `delete`, replace `state.secrets.delete(&id)?;` with `state.delete_secret(id).await?;`.

Replace `Box::new(MemoryStore::default())` with `Arc::new(MemoryStore::default())` in `testing.rs` (two places) and in `connections.rs` tests' `state_with`. In `a_failed_profile_write_removes_the_new_secret`, pass `secrets.clone()` instead of `Box::new(SharedStore(secrets.clone()))` and delete the `SharedStore` struct and its impl (an `Arc<MemoryStore>` now coerces to `Arc<dyn SecretStore>`). In `lib.rs`, `Box::new(KeychainStore)` becomes `Arc::new(KeychainStore)`.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: all pass; `grep -rnE "secrets\.(get|set|delete)" src --exclude-dir=secrets` shows only test code and `state.rs`'s helpers.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src
git commit -m "Run Keychain calls on the blocking pool so a prompt never stalls transfers"
```

---

### Task 3: `ProtectedStore` logic

**Files:**
- Move: `app/src-tauri/src/secrets.rs` → `app/src-tauri/src/secrets/mod.rs`
- Create: `app/src-tauri/src/secrets/protected.rs`

**Interfaces:**
- Consumes: `SecretStore`, `keychain_error` (in `secrets/mod.rs`), `AppError::KeychainDamaged`, `AppError::KeychainCancelled`.
- Produces:
  - `pub trait Vault: Send + Sync` with `read(&self, account: &str) -> Result<Option<String>, AppError>`, `add(&self, account: &str, contents: &str) -> Result<(), AppError>`, `remove(&self, account: &str) -> Result<(), AppError>`, `read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError>`, `remove_legacy(&self, id: &Uuid) -> Result<(), AppError>`
  - `pub const MAIN: &str = "secrets"`, `pub const NEXT: &str = "secrets.next"`
  - `pub struct ProtectedStore<V: Vault>`, `ProtectedStore::new(vault: V) -> Self`, `impl<V: Vault> SecretStore for ProtectedStore<V>`

- [ ] **Step 1: Move the module**

```bash
cd app/src-tauri && mkdir src/secrets && git mv src/secrets.rs src/secrets/mod.rs
```

At the top of `secrets/mod.rs`, after the `use` lines, add `pub mod protected;`. Change `const SERVICE` to `pub const SERVICE` and `fn keychain_error` to `pub fn keychain_error` (siblings in `vault.rs` will use them too).

- [ ] **Step 2: Write the failing tests**

Create `secrets/protected.rs` with only the test module first:

```rust
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
            self.items.lock().unwrap().insert(account.into(), contents.into());
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
        let removed = calls.iter().position(|call| call == "remove_legacy").unwrap();
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
    fn saving_over_a_damaged_item_starts_fresh() {
        let id = Uuid::new_v4();
        let vault = FakeVault::default();
        vault.put(MAIN, "not json");
        let store = ProtectedStore::new(vault);
        store.set(&id, "s3cret").unwrap();
        assert_eq!(written(&store.vault), HashMap::from([(id, "s3cret".to_string())]));
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
```

`pub mod protected;` was added in Step 1. This file compiles only once `Vault`, `ProtectedStore`, `MAIN` and `NEXT` exist.

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test --lib secrets::protected`
Expected: compile errors, `cannot find trait Vault`.

- [ ] **Step 4: Implement**

At the top of `secrets/protected.rs` (above the test module):

```rust
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

    fn loaded<'a>(
        &self,
        slot: &'a mut Option<Secrets>,
        start_over_if_damaged: bool,
    ) -> Result<&'a mut Secrets, AppError> {
        if slot.is_none() {
            let secrets = match self.load() {
                Err(AppError::KeychainDamaged) if start_over_if_damaged => Secrets::new(),
                other => other?,
            };
            *slot = Some(secrets);
        }
        Ok(slot.get_or_insert_with(Secrets::new))
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

    fn commit(&self, current: &mut Secrets, next: Secrets) -> Result<(), AppError> {
        self.persist(&next)?;
        *current = next;
        Ok(())
    }

    fn move_legacy(&self, secrets: &mut Secrets, id: &Uuid) -> Result<String, AppError> {
        let secret = self
            .vault
            .read_legacy(id)?
            .ok_or_else(|| keychain_error("no secret is saved for this connection"))?;
        let mut next = secrets.clone();
        next.insert(*id, secret.clone());
        if self.commit(secrets, next).is_ok() {
            self.vault.remove_legacy(id).ok();
        }
        Ok(secret)
    }
}

impl<V: Vault> SecretStore for ProtectedStore<V> {
    fn get(&self, id: &Uuid) -> Result<String, AppError> {
        let mut guard = self.lock()?;
        let secrets = self.loaded(&mut guard, false)?;
        match secrets.get(id) {
            Some(secret) => Ok(secret.clone()),
            None => self.move_legacy(secrets, id),
        }
    }

    fn set(&self, id: &Uuid, secret: &str) -> Result<(), AppError> {
        let mut guard = self.lock()?;
        let secrets = self.loaded(&mut guard, true)?;
        let mut next = secrets.clone();
        next.insert(*id, secret.to_string());
        self.commit(secrets, next)
    }

    fn delete(&self, id: &Uuid) -> Result<(), AppError> {
        let mut guard = self.lock()?;
        let secrets = self.loaded(&mut guard, true)?;
        self.vault.remove_legacy(id)?;
        if !secrets.contains_key(id) {
            return Ok(());
        }
        let mut next = secrets.clone();
        next.remove(id);
        self.commit(secrets, next)
    }
}
```

Why the lock is held during `load`: a second thread waits on the `Mutex` instead of starting its own read, so two tabs opening together cause one prompt. `std::sync::Mutex` is fine because no `.await` happens inside (Task 2 runs these calls on the blocking pool).

- [ ] **Step 5: Run to verify it passes**

Run: `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test --lib secrets`
Expected: all `secrets::` tests pass and clippy is clean (`ProtectedStore` is `pub`, so it isn't reported as unused before Task 4 wires it in).

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/secrets
git commit -m "Add a protected secret store that unlocks once and never drops a copy mid-write"
```

---

### Task 4: Real Keychain vault and store selection

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Create: `app/src-tauri/src/secrets/vault.rs`
- Modify: `app/src-tauri/src/secrets/mod.rs` (add `pub mod vault;`)
- Modify: `app/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Vault`, `ProtectedStore` (Task 3), `SERVICE`, `keychain_error`, `KeychainStore` (secrets/mod.rs), the three error variants (Task 1).
- Produces: `pub struct KeychainVault;` implementing `Vault`; `fn secret_store() -> Arc<dyn SecretStore>` in `lib.rs`.

- [ ] **Step 1: Add the dependency**

In `Cargo.toml` `[dependencies]`, after `keyring`:

```toml
security-framework = { version = "3", features = ["OSX_10_15"] }
```

Run: `cargo build` — expected: builds (it's already in `Cargo.lock` through `keyring`, now with one more feature).

- [ ] **Step 2: Write the failing test**

Error mapping is the only logic here that can be tested without a signed app. In `secrets/vault.rs`:

```rust
#[cfg(test)]
mod tests {
    use security_framework::base::Error;

    use super::*;

    #[test]
    fn macos_codes_become_kelp_errors() {
        assert_eq!(vault_error(Error::from_code(-128)), AppError::KeychainCancelled);
        assert_eq!(vault_error(Error::from_code(-34018)), AppError::KeychainNotSigned);
        assert!(matches!(vault_error(Error::from_code(-25308)), AppError::Keychain(_)));
    }
}
```

Add `pub mod vault;` to `secrets/mod.rs`.

Run: `cargo test --lib secrets::vault` — expected: compile error, `cannot find function vault_error`.

- [ ] **Step 3: Implement**

Above the test module in `secrets/vault.rs`:

```rust
use security_framework::access_control::SecAccessControl;
use security_framework::base::Error;
use security_framework::passwords::{
    AccessControlOptions, PasswordOptions, delete_generic_password_options, generic_password,
    set_generic_password_options,
};
use uuid::Uuid;

use super::protected::Vault;
use super::{KeychainStore, SERVICE, SecretStore, keychain_error};
use crate::error::AppError;

const ITEM_NOT_FOUND: i32 = -25300;
const USER_CANCELED: i32 = -128;
const MISSING_ENTITLEMENT: i32 = -34018;

pub struct KeychainVault;

fn vault_error(error: Error) -> AppError {
    match error.code() {
        USER_CANCELED => AppError::KeychainCancelled,
        MISSING_ENTITLEMENT => AppError::KeychainNotSigned,
        _ => keychain_error(error),
    }
}

fn options(account: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(SERVICE, account);
    options.use_protected_keychain();
    options
}

impl Vault for KeychainVault {
    fn read(&self, account: &str) -> Result<Option<String>, AppError> {
        match generic_password(options(account)) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| AppError::KeychainDamaged),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(vault_error(error)),
        }
    }

    fn add(&self, account: &str, contents: &str) -> Result<(), AppError> {
        let access = SecAccessControl::create_with_flags(AccessControlOptions::USER_PRESENCE.bits())
            .map_err(vault_error)?;
        let mut options = options(account);
        options.set_access_control(access);
        options.set_access_synchronized(Some(false));
        set_generic_password_options(contents.as_bytes(), options).map_err(vault_error)
    }

    fn remove(&self, account: &str) -> Result<(), AppError> {
        match delete_generic_password_options(options(account)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(vault_error(error)),
        }
    }

    fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError> {
        match KeychainStore::entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }

    fn remove_legacy(&self, id: &Uuid) -> Result<(), AppError> {
        KeychainStore.delete(id)
    }
}
```

If `AccessControlOptions` isn't re-exported from `passwords`, import it from `security_framework::passwords_options::AccessControlOptions` (check with `cargo doc -p security-framework --open` or the compiler's suggestion). `KeychainStore::entry` is private in `secrets/mod.rs`; child modules can use their parent's private items, so no visibility change is needed.

In `lib.rs`, replace `use crate::secrets::KeychainStore;` with:

```rust
use crate::secrets::SecretStore;
#[cfg(debug_assertions)]
use crate::secrets::KeychainStore;
#[cfg(not(debug_assertions))]
use crate::secrets::{protected::ProtectedStore, vault::KeychainVault};
```

and add above `fn transfer_manager`:

```rust
#[cfg(debug_assertions)]
fn secret_store() -> Arc<dyn SecretStore> {
    Arc::new(KeychainStore)
}

#[cfg(not(debug_assertions))]
fn secret_store() -> Arc<dyn SecretStore> {
    Arc::new(ProtectedStore::new(KeychainVault))
}
```

`cfg(debug_assertions)` is true in `tauri dev` and `cargo test` builds and false in `tauri build`, so the compiler only includes one of the two functions. In `AppState::new(...)`, `Arc::new(KeychainStore)` becomes `secret_store()`.

- [ ] **Step 4: Run to verify it passes, in both build types**

Run: `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test && cargo clippy --release -- -D warnings`
Expected: all pass. The release clippy run proves the release branch compiles.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/src
git commit -m "Use the Touch ID store in release builds and keep the login Keychain in dev"
```

---

### Task 5: Release signing config

**Files:**
- Create: `app/src-tauri/Kelp.entitlements.template`
- Create: `app/scripts/entitlements.mjs`, `app/scripts/entitlements.test.mjs`
- Modify: `app/src-tauri/tauri.conf.json`, `app/package.json`

**Interfaces:**
- Produces: `export function fillTeamId(template: string, teamId: string | undefined): string`; `Kelp.entitlements` written next to the template when `KELP_TEAM_ID` is set.

- [ ] **Step 1: Write the failing test**

`app/scripts/entitlements.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTeamId } from "./entitlements.mjs";

const template = "<string>__TEAM_ID__.dev.ozanai.kelp</string><string>__TEAM_ID__</string>";

test("fills every Team ID placeholder", () => {
  assert.equal(
    fillTeamId(template, "ABCDE12345"),
    "<string>ABCDE12345.dev.ozanai.kelp</string><string>ABCDE12345</string>",
  );
});

test("rejects a missing or malformed Team ID", () => {
  for (const teamId of [undefined, "", "abcde12345", "ABC", "ABCDE12345X"]) {
    assert.throws(() => fillTeamId(template, teamId), /Set KELP_TEAM_ID/);
  }
});
```

In `app/package.json`, change `"test": "vitest run"` to `"test": "vitest run && node --test scripts/"`.

Run: `cd app && node --test scripts/` — expected: FAIL, cannot find module `./entitlements.mjs`.

- [ ] **Step 2: Implement**

`app/scripts/entitlements.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fillTeamId(template, teamId) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
    throw new Error("Set KELP_TEAM_ID to your Apple Team ID (developer.apple.com → Membership details).");
  }
  return template.replaceAll("__TEAM_ID__", teamId);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL("../src-tauri/", import.meta.url);
  try {
    const template = readFileSync(new URL("Kelp.entitlements.template", dir), "utf8");
    writeFileSync(new URL("Kelp.entitlements", dir), fillTeamId(template, process.env.KELP_TEAM_ID));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
```

`app/src-tauri/Kelp.entitlements.template`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.application-identifier</key>
	<string>__TEAM_ID__.dev.ozanai.kelp</string>
	<key>com.apple.developer.team-identifier</key>
	<string>__TEAM_ID__</string>
	<key>keychain-access-groups</key>
	<array>
		<string>__TEAM_ID__.dev.ozanai.kelp</string>
	</array>
</dict>
</plist>
```

`tauri.conf.json`: in `build`, add `"beforeBundleCommand": "node scripts/entitlements.mjs"` (Tauri runs `before*` commands from `app/`). Replace `bundle.macOS` with:

```json
    "macOS": {
      "minimumSystemVersion": "13.0",
      "entitlements": "Kelp.entitlements",
      "files": {
        "embedded.provisionprofile": "Kelp.provisionprofile"
      }
    }
```

No `signingIdentity`: Tauri reads `APPLE_SIGNING_IDENTITY` from the environment.

- [ ] **Step 3: Run to verify it passes**

Run: `cd app && npm test && KELP_TEAM_ID=ABCDE12345 node scripts/entitlements.mjs && plutil -lint src-tauri/Kelp.entitlements && git status --short src-tauri`
Expected: tests pass; `plutil` says OK; `git status` does **not** list `Kelp.entitlements` (it's gitignored). Then `rm src-tauri/Kelp.entitlements`.

Also run `unset KELP_TEAM_ID; node scripts/entitlements.mjs; echo $?` — expected: the "Set KELP_TEAM_ID…" message and `1`.

- [ ] **Step 4: Commit**

```bash
git add app/scripts app/package.json app/src-tauri/Kelp.entitlements.template app/src-tauri/tauri.conf.json
git commit -m "Sign release builds with a Keychain entitlement filled in from KELP_TEAM_ID"
```

---

### Task 6: Sign dev builds

**Files:**
- Create: `app/src-tauri/.cargo/config.toml`
- Create: `app/src-tauri/scripts/dev-sign.sh` (executable)

**Interfaces:**
- Produces: every `cargo run`/`cargo test` binary on `aarch64-apple-darwin` is signed with an Apple Development identity when one exists, and runs unsigned otherwise.

- [ ] **Step 1: Write the runner**

`app/src-tauri/.cargo/config.toml`:

```toml
[target.aarch64-apple-darwin]
runner = "scripts/dev-sign.sh"
```

`app/src-tauri/scripts/dev-sign.sh`:

```sh
#!/bin/sh
set -e

binary="$1"
shift

identity="${KELP_DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -n 1)}"

if [ -n "$identity" ]; then
  codesign --force --sign "$identity" --identifier dev.ozanai.kelp "$binary" >/dev/null 2>&1 \
    || echo "dev-sign: couldn't sign $binary, running it unsigned" >&2
fi

exec "$binary" "$@"
```

Run: `chmod +x app/src-tauri/scripts/dev-sign.sh`

- [ ] **Step 2: Verify signing happens**

Run (in `app/src-tauri`): `cargo test --lib error:: && codesign -dv "$(ls -t target/debug/deps/kelp_lib-* | grep -v '\.d$' | head -n 1)" 2>&1 | grep -E "^(Identifier|TeamIdentifier)"`
Expected: tests pass; `Identifier=dev.ozanai.kelp` and a `TeamIdentifier=` line (your team, not printed anywhere committed).

- [ ] **Step 3: Verify the no-identity path**

Run (in `app/src-tauri`): `fake=$(mktemp -d) && printf '#!/bin/sh\n' > "$fake/security" && chmod +x "$fake/security" && PATH="$fake:$PATH" scripts/dev-sign.sh /bin/echo ran`
Expected: `ran`. (A `security` that lists no certificates simulates a machine without one: nothing is signed, the binary still runs.)

- [ ] **Step 4: Verify `tauri dev` is signed and "Always Allow" sticks** (needs a saved connection)

Run `cd app && npm run tauri dev`, open a connection, click **Always Allow** on the Keychain prompt, quit. Touch any `.rs` file, run `npm run tauri dev` again, open the connection.
Expected: no Keychain prompt the second time. `codesign -dv src-tauri/target/debug/kelp` shows `Identifier=dev.ozanai.kelp`.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/.cargo/config.toml app/src-tauri/scripts/dev-sign.sh
git commit -m "Sign dev builds with the Apple Development certificate so Always Allow sticks"
```

---

### Task 7: Docs and the hand test

**Files:**
- Modify: `README.md`, `SPEC.md`, `CLAUDE.md`, `docs/STATUS.md`

- [ ] **Step 1: README "Signing" section** (after "Getting started")

```markdown
## Signing

Dev builds (`npm run tauri dev`) are signed with your "Apple Development" certificate if you have one, so the
Keychain's "Always Allow" sticks across rebuilds. Pick a certificate with `KELP_DEV_SIGNING_IDENTITY`. Without
one, dev builds run unsigned and ask for your password each launch.

Release builds keep secrets in one Keychain item unlocked with Touch ID. They need, once:

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → + → App IDs → App. Bundle ID
   `dev.ozanai.kelp` (explicit), description "Kelp", no extra capabilities.
2. Profiles → + → Developer ID → that App ID → your Developer ID Application certificate → Generate → Download.
3. Save it as `app/src-tauri/Kelp.provisionprofile` (gitignored).

Then:

    export KELP_TEAM_ID=<your Team ID>
    export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<Team ID>)"
    cd app && npm run tauri build

After a release build has moved your secrets into the new item, `tauri dev` on the same Mac asks for the secret
keys again: they're no longer in the old Keychain item it reads.
```

- [ ] **Step 2: SPEC, CLAUDE.md, STATUS**

- `SPEC.md` §5.1: replace `credentials.rs` with `secrets/`. §7, first bullet: "Secret keys only in the macOS Keychain: one Touch ID–protected item in release builds (`security-framework`), per-connection items in dev builds (`keyring`)." §9: add "Release builds need `KELP_TEAM_ID`, `APPLE_SIGNING_IDENTITY` and `app/src-tauri/Kelp.provisionprofile` (see README)." §12 question 3: "~~Open source or closed?~~ **Decided 2026-10-16: open source.** Personal details (Team ID, signing identity, provisioning profile) stay out of the repo."
- `CLAUDE.md` security rule 1: "Secret access keys live **only** in the macOS Keychain (`keyring` in dev builds, `security-framework` in release). Never in JSON files, logs, error messages, test fixtures or commit history." Add: "Never commit the Team ID, signing identity, `Kelp.entitlements` or `Kelp.provisionprofile`."
- `docs/STATUS.md`: replace the "M4: built, not merged" and "Next: Keychain with Touch ID" sections with "M5 part 1 (Keychain with Touch ID, local signing): done, see spec `2026-10-16-kelp-keychain-touch-id-design.md`." Under M5 add: "`release.yml` fails on a `v*` tag until it gets `KELP_TEAM_ID`, `APPLE_SIGNING_IDENTITY` and the provisioning profile (base64) as secrets." Remove "SPEC §12: … open or closed source".

- [ ] **Step 3: Commit**

```bash
git add README.md SPEC.md CLAUDE.md docs/STATUS.md
git commit -m "Document signing and the Touch ID Keychain"
```

- [ ] **Step 4: Hand test on a signed release build** (needs the provisioning profile; the developer runs this)

Build as in the README, open `app/src-tauri/target/release/bundle/macos/Kelp.app`, then check:
- [ ] `codesign -d --entitlements - Kelp.app` lists `keychain-access-groups`.
- [ ] Existing connections open after one Touch ID prompt (plus one Mac password prompt per old item, once); Keychain Access no longer shows per-connection `dev.ozanai.kelp` items.
- [ ] One prompt per launch, however many connections or tabs open.
- [ ] Cancel the prompt: the "Touch ID was cancelled" message shows; open again, succeed.
- [ ] Add, edit and delete a connection without a second prompt; relaunch; the right ones open.
- [ ] A build run without the profile embedded shows the "isn't signed to use the Keychain" message.
