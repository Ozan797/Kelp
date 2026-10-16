# Kelp M5, part 1: Keychain with Touch ID and local signing

Date: 2026-10-16
Status: approved in conversation (decisions below); written spec

## 1. Purpose

Today Kelp asks for the Mac password on every launch, once per connection, because each rebuild has a new
signature and "Always Allow" never sticks. Replace that with one Touch ID prompt per launch in release builds,
and make "Always Allow" stick in dev builds. Kelp will be open source, so none of the developer's details
(Team ID, name, signing identity, provisioning profile) go into the repo.

Builds on the M2 spec (`2026-10-14-kelp-app-m2-design.md`): `SecretStore`, `KeychainStore`, saving connections.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Scope | Touch ID Keychain and local signing only. Notarisation and signing in CI, and the updater, are the next specs |
| When Touch ID asks | Once per launch, on the first secret Kelp needs. Secrets stay in memory until quit |
| Who enforces it | macOS: a data-protection Keychain item with user presence, not an app-side check |
| Dev builds | Keep today's `KeychainStore`; sign the dev binary so "Always Allow" sticks |
| Store choice | At compile time with `cfg(debug_assertions)`; a release build can never fall back |
| Library | `security-framework` 3 (feature `OSX_10_15`) for release; `keyring` stays for dev |
| Old items | Moved lazily, one connection at a time, the first time each is needed |
| Personal details | Signing identity from `APPLE_SIGNING_IDENTITY`; Team ID from `KELP_TEAM_ID` into a generated entitlements file; provisioning profile gitignored |
| Open source | Yes (settles SPEC §12 question 3) |
| Code comments | None (CLAUDE.md) |

## 3. Runtime behaviour

### 3.1 Two stores, one trait

`lib.rs` builds the store once:

| Build | Store |
|---|---|
| debug (`tauri dev`, `cargo test`) | `KeychainStore`, unchanged: one legacy item per connection, via `keyring` |
| release (`tauri build`) | `ProtectedStore`: one data-protection item for all connections |

Besides `secrets` and `lib.rs`, only `state.rs` and `commands/connections.rs` change, to call the store off the async workers (3.4).

### 3.2 The protected item

- Generic password, service `dev.ozanai.kelp`, account `secrets`.
- Value: JSON object of connection id → secret key (`{"<uuid>": "<secret>"}`).
- Data-protection keychain (`use_protected_keychain`), not synchronised to iCloud.
- Access control `USER_PRESENCE`: Touch ID, or the Mac password when Touch ID is unavailable. Built with
  `SecAccessControl::create_with_flags` and `?`, not the crate's `set_access_control_options`, which unwraps.
- No access group in code. macOS uses the first group in the entitlement, which is `<TeamID>.dev.ozanai.kelp`,
  so the Team ID never appears in source.

### 3.3 Loading once

`ProtectedStore` holds `Mutex<Option<HashMap<Uuid, String>>>`. `None` means not loaded yet.

- **First need of any secret** (`get`, `set` or `delete`): read the item. That read shows the Touch ID prompt.
  Item missing: start from an empty map, no prompt. Then keep the map in memory.
- **Later calls** use the map; no further prompts until quit.
- **Read fails** (cancelled, denied, damaged): keep `None`, return the error. The next call tries again.
- The lock is a `std::sync::Mutex`. Keychain calls are synchronous and no `.await` happens while it is held.

### 3.4 Off the async workers

A Touch ID prompt holds the calling thread until the user answers. Today `AppState::provider` and the
`save`/`delete` commands call the store inside `async fn`s, which would park tokio workers while the prompt is up.

- `AppState.secrets` becomes `Arc<dyn SecretStore>`.
- `AppState` gets `secret(id)`, `set_secret(id, secret)` and `delete_secret(id)`, each running the store call in
  `tokio::task::spawn_blocking`. A failed join maps to `AppError::Keychain("the secret store is unavailable")`.
- Every caller (`state.rs`, `commands/connections.rs`) uses these; nothing else calls `state.secrets` directly
  outside tests. This fixes the same, smaller problem in today's dev store.

### 3.5 Writing

- `set` and `delete` load first (3.3), change the map, then write the whole item: delete the old item, add the
  new one. Loading first means a write can never drop other connections' secrets.
- The in-memory map changes only after the write succeeds, so a failed write leaves memory and Keychain in step.
- `delete` of an id that isn't there succeeds without writing (today's behaviour: safe to repeat).

### 3.6 Moving old secrets over

When `get(id)` misses in the map:
1. Read the legacy item for `id` (service `dev.ozanai.kelp`, account `<uuid>`, as `KeychainStore` writes it).
   macOS may ask for the Mac password, once per old item, once ever.
2. Found: add it to the map, write the protected item, then delete the legacy item. If deleting fails, ignore
   it; the next miss can't happen because the id is now in the map.
3. Not found: return today's "no secret is saved for this connection" error.

Nothing runs at launch and no list of profiles is needed.

### 3.7 Testable seam

`ProtectedStore` is generic over a small trait with four raw operations:

```rust
trait Vault: Send + Sync {
    fn read(&self) -> Result<Option<String>, AppError>;
    fn write(&self, contents: &str) -> Result<(), AppError>;
    fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError>;
    fn delete_legacy(&self, id: &Uuid) -> Result<(), AppError>;
}
```

`KeychainVault` is the real one (`security-framework` for the item, `keyring` for legacy). A `FakeVault` in tests
counts reads and can be told to fail. Files: `secrets.rs` keeps the trait, `KeychainStore` and `MemoryStore`;
new `secrets/protected.rs` holds `ProtectedStore`, `Vault` and `KeychainVault` (`secrets.rs` becomes
`secrets/mod.rs`).

## 4. Errors

All are `AppError::Keychain`, with text the UI can show and never a secret:

| Case | Message |
|---|---|
| Touch ID cancelled (`errSecUserCanceled`) | Kelp couldn't unlock your keys because Touch ID was cancelled. Open the connection again to try once more. |
| Missing entitlement (`errSecMissingEntitlement`, -34018) | This copy of Kelp isn't signed to use the Keychain. Install it from the .dmg, or use `tauri dev` while developing. |
| Item can't be parsed | Kelp's saved keys can't be read. Re-enter the secret key for each connection. |
| Anything else | The macOS error text, as today |

A damaged item is not overwritten by a load. It is replaced only when the user saves a connection, which writes
a fresh map holding just that secret; the spec accepts losing the unreadable rest, since it can't be read anyway.

## 5. Signing

### 5.1 Release builds (`tauri build`, local for now)

- `app/src-tauri/Kelp.entitlements.template` (committed):
  `com.apple.application-identifier` = `__TEAM_ID__.dev.ozanai.kelp`,
  `com.apple.developer.team-identifier` = `__TEAM_ID__`,
  `keychain-access-groups` = [`__TEAM_ID__.dev.ozanai.kelp`]. Nothing else.
- `app/scripts/entitlements.mjs`: replaces `__TEAM_ID__` with `KELP_TEAM_ID` and writes
  `app/src-tauri/Kelp.entitlements` (gitignored). Missing or malformed (`[A-Z0-9]{10}`) `KELP_TEAM_ID` stops the
  build with: "Set KELP_TEAM_ID to your Apple Team ID (developer.apple.com → Membership details)."
- `tauri.conf.json`:
  - `build.beforeBundleCommand`: `node scripts/entitlements.mjs`
  - `bundle.macOS.entitlements`: `Kelp.entitlements`
  - `bundle.macOS.files`: `{ "embedded.provisionprofile": "Kelp.provisionprofile" }`
  - No `signingIdentity`; Tauri reads `APPLE_SIGNING_IDENTITY` from the environment. Hardened runtime stays on.
- `Kelp.provisionprofile` is gitignored. To make it (needs the developer's Apple login):
  1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → + → App IDs → App.
     Explicit Bundle ID `dev.ozanai.kelp`, description "Kelp". No extra capabilities.
  2. Profiles → + → Distribution → Developer ID → App ID `dev.ozanai.kelp` → the Developer ID Application
     certificate → name "Kelp Developer ID" → Generate → Download.
  3. Save it as `app/src-tauri/Kelp.provisionprofile`.

A local release build is then:

```bash
export KELP_TEAM_ID=<Team ID>
export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<Team ID>)"
cd app && npm run tauri build
```

### 5.2 Dev builds (`tauri dev`)

- `app/src-tauri/.cargo/config.toml`: `[target.aarch64-apple-darwin] runner = "scripts/dev-sign.sh"`.
- `app/src-tauri/scripts/dev-sign.sh`: signs `$1` with `KELP_DEV_SIGNING_IDENTITY`, or else the first
  "Apple Development" identity from `security find-identity -v -p codesigning`, then `exec`s it with the rest of
  the arguments. No identity found (CI, other contributors): runs it unsigned, as today.
- The legacy Keychain matches "Always Allow" against the signing identity, so it sticks across rebuilds.
- Test binaries go through the runner too; signing adds a fraction of a second.

### 5.3 What CI sees

`ci.yml` doesn't bundle, so it never needs the profile or the Team ID. `release.yml` would fail on a `v*` tag
until the next spec adds `KELP_TEAM_ID`, `APPLE_SIGNING_IDENTITY` and the profile (base64) as GitHub secrets.
Nothing is released yet; `docs/STATUS.md` records it.

## 6. Testing

Rust unit tests on `FakeVault`:
- Two `get`s read the item once.
- A cancelled read stores nothing; the next `get` reads again and succeeds.
- `set` on a store with one saved secret keeps it and adds the new one in the written JSON.
- `delete` removes one id and keeps the others; deleting a missing id doesn't write.
- A failed write leaves the in-memory map unchanged.
- A legacy secret is returned, written into the item, then the legacy item is deleted, in that order.
- A damaged item gives the "can't be read" error and isn't written by the load.
- No error message contains the secret.

`scripts/entitlements.mjs`: a `node --test` check that it fills the Team ID and rejects a missing or malformed one.

By hand, on a signed `tauri build` (the real Keychain can't be reached from `cargo test`):
- [ ] Existing connections open after one Touch ID prompt, and old items are gone from Keychain Access.
- [ ] One prompt per launch, however many connections or tabs open.
- [ ] Cancel the prompt, see the message, open again, succeed.
- [ ] Add, edit and delete a connection; relaunch; the right ones still open.
- [ ] `tauri dev`: click "Always Allow" once, rebuild twice, no password prompt.

## 7. Docs to update

- `README.md`: a "Signing" section (5.1 and 5.2).
- `SPEC.md`: §5.1 file list, §7 Security, §9 Distribution, §12 question 3 (open source).
- `CLAUDE.md` security rule: "Secret access keys live only in the macOS Keychain (`keyring` in dev builds,
  `security-framework` in release)."
- `.gitignore`: `app/src-tauri/Kelp.entitlements`, `app/src-tauri/Kelp.provisionprofile`.
- `docs/STATUS.md`: this part done, `release.yml` needs secrets.

## 8. Not in this spec

Notarisation and signing in `release.yml`, the updater (SPEC §9.1), a Settings switch for Touch ID, and moving
secrets out of the protected item back to legacy.
