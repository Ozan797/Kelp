# Bucket Browser – Specification

> Working name. Change it in `website/src/config.ts`, `src-tauri/tauri.conf.json` and `package.json`.

## 1. Overview

A fast, modern desktop app for browsing and transferring files across object storage: **Amazon S3**, **Cloudflare R2** and **Hetzner Object Storage**. Think Cyberduck, but quicker and nicer to use.

- **Platform:** macOS, Apple Silicon only (`aarch64-apple-darwin`), macOS 13+.
- **Stack:** Rust core, Tauri 2 shell, React + TypeScript + Vite UI.
- **Distribution:** signed `.dmg` on GitHub Releases, linked from a landing site on a `*.ozanai.dev` subdomain.

## 2. Goals and non-goals

**Goals**
- Opens fast, lists fast, never freezes the UI.
- One consistent interface for every provider.
- Credentials are kept in the macOS Keychain and nowhere else.
- Reliable large transfers: parallel, pausable, resumable, retried.
- A UI that feels current: keyboard-first, command palette, dark and light themes.

**Non-goals (for now)**
- Windows and Linux builds.
- Full S3 admin (IAM, lifecycle rules, bucket policies, replication).
- Sync and backup scheduling.
- Providers other than S3-compatible ones (see Open questions for Hetzner Storage Box).

## 3. Providers

All three speak the S3 API, so one implementation covers them. They differ only in connection settings.

| Provider | Endpoint | Region | Notes |
|---|---|---|---|
| Amazon S3 | default AWS endpoint | e.g. `eu-west-2` | Full feature set |
| Cloudflare R2 | `https://<account_id>.r2.cloudflarestorage.com` | `auto` | No ACLs; some versioning differences |
| Hetzner Object Storage | `https://<location>.your-objectstorage.com` | location, e.g. `fsn1` | Verify multipart and presign behaviour |

Path-style vs virtual-host addressing must be a per-connection option, since some providers need one or the other.

## 4. Features and milestones

**M1 – Core (CLI proof)**
- `StorageProvider` trait with an S3 implementation.
- List (with prefix, delimiter, pagination), head, get, put, delete.
- Verified against one real bucket per provider.

**M2 – Basic app**
- Tauri shell, connection list, file list with breadcrumbs.
- Add, edit, delete connection profiles; secrets in Keychain.
- Download and upload single files with progress.

**M3 – Transfers**
- Transfer queue with concurrency limit, pause, resume, cancel, retry with backoff.
- Multipart upload and ranged parallel download for large files.
- Folder upload and download (recursive).

**M4 – Polish**
- Command palette (⌘K), keyboard navigation, multi-select, context menus.
- Drag and drop from Finder; drag between connections.
- Quick preview for images, text, video.
- Tabs for multiple connections or locations.
- Dark and light themes: follow the system by default, with a System / Light / Dark override in settings and ⌘K.

**M5 – Release**
- Code signing and notarisation, auto-update, landing site live.
- **No public build without the updater.** A build without it can never update itself, so everyone who downloaded it would be stuck on that version (see 9.1).

**Later**
- Search across a bucket with a local index.
- Server-side copy between buckets on the same provider.
- Hetzner Storage Box over SFTP (second provider implementation).

## 5. Architecture

```
React UI  ──invoke / events──▶  Tauri commands  ──▶  providers  ──▶  S3 API
   ▲                                  │
   └────────── events ◀── transfers (queue + workers, tokio)
```

- The UI only calls `commands/`. Commands only call `providers/` and `transfers/`.
- Nothing slow runs on the UI thread. Listing and transfers are async tasks on tokio.
- Progress is pushed to the UI with Tauri events, throttled (about 10 per second per transfer).

### 5.1 Repository layout

```
bucket-browser/
├── SPEC.md  CLAUDE.md  README.md
├── package.json  vite.config.ts  index.html
├── src/                  # app UI (React + TS)
├── src-tauri/            # Rust core
│   └── src/
│       ├── commands/     # what the UI can call
│       ├── providers/    # StorageProvider trait + s3.rs (+ sftp.rs later)
│       ├── transfers/    # queue.rs, worker.rs
│       ├── credentials.rs  state.rs  error.rs  lib.rs  main.rs
├── website/              # landing site (separate Vite project)
└── .github/workflows/    # release.yml
```

### 5.2 Provider trait (sketch)

```rust
#[async_trait]
pub trait StorageProvider: Send + Sync {
    async fn list(&self, bucket: &str, prefix: &str, token: Option<String>) -> Result<ListPage>;
    async fn head(&self, bucket: &str, key: &str) -> Result<ObjectMeta>;
    async fn get_range(&self, bucket: &str, key: &str, range: Range<u64>) -> Result<ByteStream>;
    async fn put(&self, bucket: &str, key: &str, body: ByteStream, len: u64) -> Result<()>;
    async fn delete(&self, bucket: &str, keys: &[String]) -> Result<()>;
    async fn copy(&self, from: &ObjectRef, to: &ObjectRef) -> Result<()>;
    async fn presign_get(&self, bucket: &str, key: &str, ttl: Duration) -> Result<String>;
}
```

`ListPage` holds `folders` (from common prefixes), `objects`, and an optional `next_token`.

### 5.3 Data model

```
ConnectionProfile {
  id: Uuid,
  name: String,
  kind: S3 | R2 | Hetzner,
  endpoint: Option<String>,
  region: String,
  path_style: bool,
  access_key_id: String,        // stored in profile file
  // secret_access_key         // stored ONLY in Keychain, keyed by profile id
}
```

Profiles (without secrets) are stored as JSON in the app data directory.

### 5.4 Tauri commands (initial set)

`list_connections`, `save_connection`, `delete_connection`, `test_connection`,
`list_buckets`, `list_objects`, `delete_objects`, `create_folder`,
`start_upload`, `start_download`, `pause_transfer`, `resume_transfer`, `cancel_transfer`, `list_transfers`.

Events: `transfer://progress`, `transfer://state`.

### 5.5 Transfer engine

- Global concurrency limit (default 4 files) and per-file part concurrency (default 4 parts).
- Multipart upload above 16 MiB, 8 MiB parts. Ranged GETs for large downloads.
- Retries with exponential backoff and jitter; each part retries independently.
- Pause and resume persist state to disk so a restart can resume.
- Downloads write to a `.part` file and rename on completion.

### 5.6 Folder semantics

Object storage has no real folders. A "folder" is a key prefix ending in `/`.
- Create folder: put a zero-byte object named `prefix/`.
- Rename or move folder: copy and delete every key under the prefix, with a confirmation that shows the object count.
- Delete folder: list and batch-delete (up to 1000 keys per request).

## 6. UI and UX

- Layout: sidebar (connections and buckets), main file list, optional preview pane, transfer drawer at the bottom.
- File list is virtualised (TanStack Virtual) so 100k rows scroll smoothly.
- Listing streams in page by page; the first page appears immediately.
- ⌘K opens a command palette for navigation and actions.
- Empty and error states say what happened and what to do next.
- Respect reduced motion, visible focus states, system dark/light theme.

## 7. Security

- Secret keys only in macOS Keychain (`keyring` crate). Never in profile JSON, logs, or crash reports.
- Logs redact keys, signatures and presigned URLs.
- Tauri capabilities are minimal: no arbitrary shell, no arbitrary fs access beyond user-picked paths.
- Strict Content Security Policy in `tauri.conf.json`.
- Destructive actions (delete, overwrite) require confirmation, with a count.

## 8. Performance targets

These are goals to measure against, not promises.
- App window visible in under 1 s on an M-series Mac.
- First page of a 1000-object listing displayed in under 300 ms after the response arrives.
- UI stays at 60 fps while four transfers run.
- Idle memory under 150 MB.

## 9. Distribution

- Build on a `macos-latest` GitHub Actions runner (Apple Silicon) with `tauri-apps/tauri-action` on a `v*` tag.
- Sign and notarise with an Apple Developer ID (needs a paid Apple Developer account).
- Publish `Bucket-Browser_aarch64.dmg` to GitHub Releases.
- Auto-update with `tauri-plugin-updater` using signed update manifests.

### 9.1 Auto-update

Everyone who has installed Kelp gets new versions automatically.

- **Signing key.** Generate it once with `npm run tauri signer generate`. The public key goes in `tauri.conf.json` (`plugins.updater.pubkey`). The private key and its password go in the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Back the private key up in a password manager.** If it is lost, existing installs can never accept another update.
- **Build.** Set `bundle.createUpdaterArtifacts: true`. On a `v*` tag, `tauri-action` (with `includeUpdaterJson: true`) uploads the `.dmg`, a signed `Kelp.app.tar.gz`, and a `latest.json` manifest to the release.
- **Endpoint.** `https://github.com/Ozan797/Kelp/releases/latest/download/latest.json`. "latest" only covers *published* releases, so users get an update when you click Publish on the draft, not when the tag is pushed. This could move to the R2 download domain later without changing the app's behaviour, as long as the old endpoint keeps working.
- **In the app.** Check on launch and then every 6 hours. Download the update in the background. Then show a non-blocking banner, "Kelp 0.2.0 is ready. Restart to update", with the release notes and a "Later" option. Never restart while transfers are running: if the user clicks Restart then, ask them first and show how many transfers are in progress. Add a "Check for updates…" menu item.
- **Capabilities.** Only `updater:default` and `process:allow-restart` (from `tauri-plugin-process`).
- **First release.** v0.1.0 must include the updater. Before publishing, test it by installing v0.1.0 and then releasing v0.1.1.

## 10. Landing website

- Separate Vite + React + TS project in `website/`, deployed as static files on a subdomain of `ozanai.dev`.
- Content: hero with a live interactive preview of the app, feature list, download section with install steps.
- The download button points at the latest GitHub Release asset. It shows "Download coming soon" until `released` is set to `true` in `website/src/config.ts`.
- Hosting options: Cloudflare Pages or Netlify (both accept a custom subdomain via a CNAME record).

## 11. Testing

- Rust unit tests for pagination, key and prefix handling, retry logic.
- Integration tests against a local S3-compatible server (MinIO) in CI.
- Manual test pass against real S3, R2 and Hetzner buckets before each release.
- Frontend: type-check plus component tests for the file list and transfer drawer.

## 12. Open questions

1. **Hetzner:** is it Object Storage (S3) or a Storage Box (SFTP/WebDAV/SMB)? This spec assumes Object Storage.
2. **Name and domain:** final app name and the exact subdomain.
3. **Open source or closed?** Affects the GitHub Releases plan and the website's source link.
4. **Apple Developer account:** needed for signing and notarisation before sharing widely.
5. **S3 library:** `aws-sdk-s3` (full feature coverage, heavier build) vs OpenDAL (one API for many backends). Decide at the end of M1 after a small spike on each.
