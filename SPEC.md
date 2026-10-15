# Kelp – Specification

> App name: Kelp. Change it in `website/src/config.ts`, `app/src-tauri/tauri.conf.json` and `app/package.json`.

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

**M1 – Core (CLI proof)** · done (verified on S3 and Hetzner; R2 still to verify)
- `StorageProvider` trait with an S3 implementation.
- List (with prefix, delimiter, pagination), head, get, put, delete.
- Verified against one real bucket per provider.

**M2 – Basic app** · done
- Tauri shell, connection list, file list with breadcrumbs.
- Saved connections: add once, then open from the sidebar with one click (see 5.7).
- Add, edit, delete connection profiles; secrets in Keychain.
- Test a connection before saving it, so a wrong key shows up at once.
- Reopen each connection in the bucket and folder you last had open.
- Download and upload single files with progress.

**M3 – Transfers** · done (design: `docs/superpowers/specs/2026-10-15-kelp-m3-transfers-design.md`)
- Transfer queue with concurrency limit, pause, resume, cancel, retry with backoff.
- Multipart upload and ranged parallel download for large files.
- Folder upload and download (recursive).

- Bucket and folder size, counted in the background (see 5.8).

**M4 – Polish**
- Command palette (⌘K), keyboard navigation, multi-select, context menus.
- Drag and drop from Finder (done: `docs/superpowers/specs/2026-10-15-kelp-m4-drop-design.md`); drag between connections.
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
kelp/
├── SPEC.md  CLAUDE.md  README.md
├── app/                  # the Mac app (its own npm project)
│   ├── package.json  vite.config.ts  index.html
│   ├── src/              # app UI (React + TS)
│   └── src-tauri/        # Rust core
│       └── src/
│           ├── commands/     # what the UI can call
│           ├── providers/    # StorageProvider trait + s3.rs (+ sftp.rs later)
│           ├── transfers/    # model, queue, plan, retry, store, manager, worker
│           ├── usage.rs      # bucket and folder size
│           ├── credentials.rs  state.rs  error.rs  lib.rs  main.rs
├── website/              # landing site (separate Vite project)
├── design/               # shared tokens, components, fonts, brand
├── docs/                 # design specs and implementation plans
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
  last_location: Option<{ bucket: String, prefix: String }>,  // where to reopen
}

UsageResult {
  bucket: String,
  prefix: String,               // "" for the whole bucket
  bytes: u64,
  objects: u64,
  counted_at: DateTime,
  complete: bool,               // false while counting or if cancelled
  resume_token: Option<String>, // continuation token, so an interrupted count can resume
}
```

Profiles (without secrets) are stored as JSON in the app data directory. Usage results are cached as JSON
next to them, per connection, bucket and prefix.

### 5.4 Tauri commands

`list_connections`, `save_connection`, `delete_connection`, `test_connection`, `set_last_location`,
`list_buckets`, `list_objects`, `delete_objects`, `create_folder`,
`list_transfers`, `start_upload`, `start_download`, `plan_folder_upload`, `start_folder_upload`, `start_folder_download`,
`pause_transfer`, `resume_transfer`, `retry_transfer`, `cancel_transfer`, `pause_all`, `resume_all`,
`get_usage`, `start_usage_count`, `cancel_usage_count`.

Events: `transfer://progress`, `transfer://state`, `usage://progress`.

### 5.5 Transfer engine

- 4 transfers run at once; each sends up to 4 requests (parts, ranges or files); at most 16 requests in flight.
- Multipart upload above 16 MiB, 8 MiB parts (larger for files over 80 GB, to stay under 10,000 parts). Downloads fetch 8 MiB ranges.
- Retries on network and busy errors: 5 attempts, backoff 1, 2, 4, 8, 16 s (max 30 s) with jitter; each part retries independently.
- Finished parts and ranges are saved in `transfers.json`, so pause, quit and resume all continue where they stopped.
- Downloads write to a `.part` file and rename on completion.

### 5.6 Folder semantics

Object storage has no real folders. A "folder" is a key prefix ending in `/`.
- Create folder: put a zero-byte object named `prefix/`.
- Rename or move folder: copy and delete every key under the prefix, with a confirmation that shows the object count.
- Delete folder: list and batch-delete (up to 1000 keys per request).

### 5.7 Saved connections

- Adding a connection: pick the provider, enter a name, keys and location/region/account ID, then
  **Test connection** or **Save connection**. Both run the same check (`list_buckets`; if the key can't list
  buckets, it asks for a bucket name and checks that bucket). Save writes only when the check passes, so bad
  keys are never saved. Details: `docs/superpowers/specs/2026-10-14-kelp-app-m2-design.md` section 5.
- Saving writes the profile JSON and puts the secret in the Keychain under the profile id. If the Keychain write
  fails, nothing is saved and the error says why.
- The sidebar lists saved connections. Clicking one reads the secret from the Keychain and opens it; no typing.
- Each connection remembers its last bucket and folder (`set_last_location`, debounced) and reopens there. If that
  bucket or folder is gone, it opens the bucket list instead and says so.
- Editing can change everything; leaving the secret field empty keeps the stored secret. Deleting a connection
  asks for confirmation and removes its Keychain item too.

### 5.8 Bucket and folder size

There is no S3 call for "how big is this bucket"; the only universal way is listing every object, 1000 per
request. A bucket with 10 million objects needs 10,000 requests. Each request is quick, so nothing times out; the
risk is total time, and blocking the UI while it runs. So:

- **On request only.** A "Calculate size" action on a bucket or folder. Never automatic for a whole bucket.
- **Background job.** `start_usage_count` runs on tokio like a transfer, emits `usage://progress` about twice a
  second ("2.4 M files, 812 GB so far"), and can be cancelled. Pages retry with backoff on their own.
- **Parallel by prefix.** List top-level prefixes first (delimiter `/`), then count up to 4 prefixes at once.
- **Cached and resumable.** Results are stored as `UsageResult` and shown with their age ("1.2 TB · 3.1 M files ·
  counted 3 hours ago · Recalculate"). An interrupted count resumes from its saved continuation token.
- **Show used, not full.** Buckets have no fixed capacity, so the UI shows size and object count, not a fill bar.
- **Say what's not counted.** A plain listing skips old versions and unfinished multipart uploads, which still use
  storage. Offer "Include old versions and unfinished uploads" (ListObjectVersions + ListMultipartUploads).
- **Cost.** About one LIST request per 1000 objects: a few cents for 10 million objects on S3 or R2.
- **Later, faster where providers allow:** Amazon S3 publishes daily `BucketSizeBytes` / `NumberOfObjects` in
  CloudWatch (needs a CloudWatch read permission; up to a day old). Cloudflare R2 exposes storage in its GraphQL
  Analytics API (needs a separate Cloudflare API token). Hetzner: no usage API known; to check. These stay inside
  `providers/` as an optional capability, with the background count as the fallback.

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
- Publish `Kelp_<version>_aarch64.dmg` to GitHub Releases.
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

1. ~~**Hetzner:** Object Storage or Storage Box?~~ **Decided 2026-10-14: Hetzner Object Storage (S3).** Storage Box over SFTP stays under "Later".
2. **Name and domain:** final app name and the exact subdomain.
3. **Open source or closed?** Affects the GitHub Releases plan and the website's source link.
4. **Apple Developer account:** needed for signing and notarisation before sharing widely.
5. **S3 library:** `aws-sdk-s3` (full feature coverage, heavier build) vs OpenDAL (one API for many backends). Decide at the end of M1 after a small spike on each.
