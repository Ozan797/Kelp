# Kelp M3 transfers and size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A transfer queue with pause, resume, retry and restart survival; files of any size; folder transfers; background bucket and folder size.

**Architecture:** A pure queue model (`transfers/queue.rs`) decides; a `TransferManager` runs workers on tokio, saves `transfers.json` and emits events. A transfer is a list of items, so files and folders share one path. Pause aborts the worker; finished parts and ranges are saved, so resume and restart re-use the same code.

**Tech Stack:** Rust (tokio, aws-sdk-s3, serde), Tauri 2, React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-kelp-m3-transfers-design.md`

## Global Constraints

- No comments, doc comments or file headers in new or changed code (CLAUDE.md).
- No `unwrap()`/`expect()` outside tests; never hold a lock across `.await` unless it is a `tokio::sync` lock, and keep even those short.
- `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test`, `npm test`, `npm run typecheck` (in `app/`) pass at every commit.
- S3 code only in `providers/`. Commands only call `providers/`, `transfers/` and `usage`.
- No secrets, presigned URLs or signatures in logs, errors or `transfers.json`.
- Limits (spec §3): 4 transfers, 16 requests, 4 requests per transfer, multipart over 16 MiB, part 8 MiB (or `ceil(size/10_000)` rounded up to 1 MiB), max 5 TiB, ranges 8 MiB, 5 attempts, backoff 1/2/4/8/16 s capped 30 s with up to 50% jitter, save at once on status change else ≤1/s, progress ≤10/s, usage progress ≤2/s.
- UI copy: sentence case, buttons say what they do, errors explain and never apologise. Semantic CSS tokens only.
- Commit messages: plain, no `Co-Authored-By` trailer.

## Review Focus

1. **Zero-byte files** upload and download (no parts, no ranges): the transfer finishes and an empty file/object exists. Test in Task 9.
2. **Damaged `transfers.json`** (crash mid-write by another tool, hand edit): Kelp still opens with an empty queue and moves the bad file aside as `transfers.json.damaged`. Test in Task 3.
3. **Connection deleted while its transfers wait**: they fail with `ConnectionNotFound`, nothing panics. Test in Task 5.
4. **Folder keys with `..`, `.` or empty segments**: skipped as failed items, never written outside the target folder. Test in Task 11.
5. **Local file edited while an upload is paused**: resume restarts that file from zero and aborts the old multipart upload. Test in Task 9.

---

## Phase 1 · Queue engine

### Task 1: Errors and retry rules

**Files:**
- Modify: `app/src-tauri/src/error.rs`
- Create: `app/src-tauri/src/transfers/retry.rs` (module created in Task 2; put this file in place now and add `pub mod retry;` with Task 2's `mod.rs`, or create `transfers/mod.rs` here with only `pub mod retry;`)
- Modify: `app/src/lib/tauri.ts` (`ErrorKind` gains `"busy" | "objectChanged"`)

**Interfaces:**
- Produces: `AppError::Busy` (kind `"busy"`, message "The storage provider is busy. Kelp will keep trying."), `AppError::ObjectChanged` (kind `"objectChanged"`, message "This file changed on the server while it was downloading. Kelp will start it again."), `pub fn is_retryable(error: &AppError) -> bool`, `pub fn backoff(attempt: u32, jitter: f64) -> Duration` (`attempt` from 1, `jitter` in `0.0..=1.0`).

- [ ] **Step 1: Tests.** In `error.rs`: `from_provider_code` maps `SlowDown`, `InternalError`, `ServiceUnavailable`, `RequestTimeout` → `Busy`, `PreconditionFailed` → `ObjectChanged`; `FileTooLarge` message equals "This file is larger than 5 TB, the most S3 allows in one object."; extend `every_variant_has_a_camel_case_kind`. In `retry.rs`:
```rust
assert!(is_retryable(&AppError::Network) && is_retryable(&AppError::Busy));
assert!(!is_retryable(&AppError::AccessDenied) && !is_retryable(&AppError::ObjectChanged));
assert_eq!(backoff(1, 0.0), Duration::from_secs(1));
assert_eq!(backoff(5, 0.0), Duration::from_secs(16));
assert_eq!(backoff(9, 0.0), Duration::from_secs(30));
assert_eq!(backoff(2, 1.0), Duration::from_secs(3));
```
- [ ] **Step 2:** `cargo test` → fails to compile.
- [ ] **Step 3:** Implement. `backoff` = `min(2^(attempt-1), 30) s × (1 + jitter/2)`. Add `pub fn jitter() -> f64` using `SystemTime` sub-second nanos (no new crate).
- [ ] **Step 4:** `cargo test` passes; `npm run typecheck`.
- [ ] **Step 5:** Commit "Add busy and changed-object errors and retry rules".

### Task 2: Transfer model and pure queue

**Files:**
- Move: `app/src-tauri/src/transfers.rs` → `app/src-tauri/src/transfers/paths.rs` (keep its tests; `Throttle` moves too)
- Create: `transfers/mod.rs`, `transfers/model.rs`, `transfers/queue.rs`
- Modify: `commands/transfers.rs` imports only

**Interfaces:**
- Produces (`model.rs`, all `Serialize + Deserialize`, `rename_all = "camelCase"`):
```rust
pub enum Direction { Upload, Download }
pub enum Kind { File, Folder }
pub enum Status { Waiting, Running, Retrying { at_ms: u64 }, Paused, Failed, Finished, Cancelled }
pub enum ItemState { Pending, Done, Failed(AppError) }
pub struct CompletedPart { pub number: u32, pub etag: String }
pub enum Resume {
    Upload { upload_id: String, part_size: u64, parts: Vec<CompletedPart>, local_size: u64, local_modified_ms: u64 },
    Download { etag: String, part_path: PathBuf, done_ranges: Vec<u32> },
}
pub struct Item { pub local: PathBuf, pub key: String, pub size: u64, pub state: ItemState, pub resume: Option<Resume> }
pub struct Transfer { pub id: Uuid, pub connection_id: Uuid, pub direction: Direction, pub kind: Kind, pub name: String,
    pub bucket: String, pub local_root: PathBuf, pub remote_root: String, pub status: Status,
    pub error: Option<AppError>, pub items: Vec<Item> }
pub struct TransferView { id, direction, kind, name, destination: String, status: Status, retry_at: Option<u64>,
    total: u64, done: u64, files_total: u64, files_done: u64, files_failed: u64, error: Option<AppError>, path: Option<String> }
impl Transfer { pub fn view(&self, done_bytes: u64) -> TransferView }
```
  `AppError` needs `Deserialize` (derive on a mirror `{ kind, message }`, deserialising to `AppError::Provider(message)` for unknown kinds is fine; simplest: implement `Deserialize` that rebuilds from `kind` + `message` with `Provider(message)` as the fallback).
- Produces (`queue.rs`): `pub struct Queue { transfers: Vec<Transfer> }` with
  `add(Transfer)`, `get(Uuid) -> Option<&Transfer>`, `get_mut`, `all() -> &[Transfer]`,
  `next_to_start(&self, running: usize) -> Vec<Uuid>` (Waiting in insertion order, up to `4 - running`),
  `pause(Uuid) -> bool` (Waiting/Running/Retrying → Paused), `resume(Uuid) -> bool` (Paused → Waiting),
  `retry(Uuid) -> bool` (Failed → Waiting, failed items → Pending, error cleared),
  `remove(Uuid) -> Option<Transfer>`, `finish(Uuid)` (Finished if no failed items else Failed with
  `AppError::Provider("N files failed")`-style message: "2 files failed." / "1 file failed."),
  `restore_after_launch(&mut self)` (Running/Retrying → Waiting; drop Finished/Cancelled), `const MAX_RUNNING: usize = 4`.

- [ ] **Step 1: Tests in `queue.rs`:** six waiting, `next_to_start(0)` gives first four, `next_to_start(4)` none; pause a Retrying → Paused; resume Paused → Waiting (and Waiting can't resume); retry resets only failed items; `finish` with one failed item → Failed "1 file failed."; `restore_after_launch` keeps Paused and Failed, turns Running into Waiting. Model test: `view` sums sizes and counts files.
- [ ] **Step 2:** Run, fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` (old `paths` tests still pass).
- [ ] **Step 5:** Commit "Add the transfer model and queue".

### Task 3: Saving transfers

**Files:** Create `transfers/store.rs`.

**Interfaces:**
- Produces: `pub struct TransferStore { path: PathBuf }`, `new(dir: &Path)` (file `transfers.json`), `load(&self) -> Vec<Transfer>`, `save(&self, transfers: &[Transfer]) -> Result<(), AppError>` (temp file + `sync_all` + rename, same as `ProfileStore::save`; only Waiting/Running/Retrying/Paused/Failed are written).

- [ ] **Step 1: Tests:** round-trip keeps a Paused upload with its `Resume`; Finished is not written; missing file → empty; damaged file → empty **and** the file is renamed to `transfers.json.damaged` (Review Focus 2).
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Save unfinished transfers to transfers.json".

### Task 4: In-memory fake provider

**Files:** Modify `app/src-tauri/src/testing.rs`.

**Interfaces:**
- Produces: `FakeProvider::with_objects(self, objects: Vec<(&str, Vec<u8>)>) -> Self`, `pub fn object(&self, key: &str) -> Option<Vec<u8>>`, `pub fn fail_next(&self, count: usize, error: AppError)`, `pub fn calls(&self, name: &str) -> usize`. `put_file` and `get_file` work against the in-memory map (later tasks add multipart and ranges here too). Existing constructors keep working.

- [ ] **Step 1: Test** in `testing.rs`: `put_file` then `object` returns the bytes; `fail_next(2, Network)` makes the next two calls fail then succeeds.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Fake provider keeps objects in memory and can fail on cue".

### Task 5: Transfer manager and worker for small files

**Files:** Create `transfers/manager.rs`, `transfers/worker.rs`.

**Interfaces:**
- Consumes: Tasks 1–4; `AppState::provider(id)`.
- Produces:
```rust
pub enum Event { State(TransferView), Progress { id: Uuid, done: u64, total: u64, files_done: u64 } }
pub type Emit = Arc<dyn Fn(Event) + Send + Sync>;
pub type ProviderFor = Arc<dyn Fn(Uuid) -> BoxFuture<'static, Result<Arc<dyn StorageProvider>, AppError>> + Send + Sync>;
pub struct TransferManager { /* Mutex<Inner>, Arc<Semaphore> (16), store, emit, provider_for */ }
impl TransferManager {
    pub fn new(store: TransferStore, emit: Emit, provider_for: ProviderFor) -> Arc<Self>;  // loads + restore_after_launch, then pump
    pub async fn add(self: &Arc<Self>, transfer: Transfer) -> Uuid;
    pub async fn list(&self) -> Vec<TransferView>;
    pub async fn pause(self: &Arc<Self>, id: Uuid); pub async fn resume(self: &Arc<Self>, id: Uuid);
    pub async fn retry(self: &Arc<Self>, id: Uuid); pub async fn cancel(self: &Arc<Self>, id: Uuid);
    pub async fn pause_all(self: &Arc<Self>); pub async fn resume_all(self: &Arc<Self>);
}
```
  Worker callbacks on the manager (crate-private): `progress(id, delta: i64)`, `item_done(id, index)`, `item_failed(id, index, AppError)`, `set_resume(id, index, Option<Resume>)`, `retrying(id, at_ms)`, `running(id)`, `worker_finished(id)`. `pump()` starts `queue.next_to_start(running)`, each as a `tokio::spawn`ed `worker::run(manager, transfer_snapshot, provider)` whose `JoinHandle` is kept for abort. `BoxFuture` = `Pin<Box<dyn Future<Output = T> + Send>>` (no new crate).
- Worker (this task): for each Pending item, one request: upload → `put_file`, download → `get_file` into a reserved `.part` then `finish_download`. Each request takes a permit from the 16-request semaphore and retries per Task 1 rules, calling `retrying` while it sleeps. Up to 4 items at once.

- [ ] **Step 1: Tests** (`#[tokio::test]`, fake provider, events captured in a `Mutex<Vec<Event>>`): upload finishes and object exists; six transfers → never more than 4 Running at once; `fail_next(2, Network)` → a Retrying event then Finished (use `tokio::time::pause()` so backoff is instant); `fail_next(5, Network)` → Failed; `AccessDenied` → Failed without retry; pause a running one → Paused and the next waiting starts; cancel a waiting one → Cancelled event and gone from `list`; a transfer whose connection is unknown (`provider_for` returns `ConnectionNotFound`) → Failed with that error (Review Focus 3); a new manager on the same store dir restores a Paused one.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Run transfers through a queue with pause, resume and retry".

### Task 6: Commands

**Files:** Rewrite `app/src-tauri/src/commands/transfers.rs`; modify `lib.rs`.

**Interfaces:**
- Consumes: Task 5.
- Produces commands: `list_transfers`, `start_upload(id, bucket, prefix, path, replace)`, `start_download(id, bucket, key)` (size from the item; `size` argument removed), `pause_transfer`, `resume_transfer`, `retry_transfer`, `cancel_transfer` (all `transfer: Uuid`), `pause_all`, `resume_all`. Manager is managed state `Arc<TransferManager>`; built in `setup` with `emit` mapping `Event::State` → `transfer://state`, `Event::Progress` → `transfer://progress` (progress throttled 10/s per transfer in the manager), and `provider_for` calling `AppState::provider`. `start_upload` keeps the `AlreadyExists` check and the `> 5 TiB → FileTooLarge` check (constant `MAX_OBJECT_SIZE = 5 * 1024^4` in `providers/mod.rs`; `MAX_SINGLE_UPLOAD` stays private to `s3.rs`).

- [ ] **Step 1:** Move the useful old tests (unique names etc. already live in `paths.rs`); add a test that `start_upload` on an existing key without `replace` returns `AlreadyExists` (call a plain `async fn upload_transfer(state, ...) -> Result<Transfer, AppError>` helper, not the Tauri command).
- [ ] **Step 2–4:** fail, implement, pass; `cargo clippy -- -D warnings`.
- [ ] **Step 5:** Commit "Wire the transfer queue to the app".

### Task 7: Drawer with queue states

**Files:** Modify `app/src/lib/tauri.ts`, `hooks/useTransfers.ts` (+ test), `components/TransferDrawer.tsx` (+ test), `components/StatusBar.tsx`, `App.tsx`, `app.css`.

**Interfaces:**
- Consumes: Task 6 commands and events.
- Produces: `TransferStatus = "waiting" | "running" | "retrying" | "paused" | "failed" | "finished" | "cancelled"`; `TransferView` type (spec §7, camelCase); `api.listTransfers/pauseTransfer/resumeTransfer/retryTransfer/pauseAll/resumeAll`; `startDownload(id, bucket, key)`. Hook returns `{ transfers, clearFinished }` with `Transfer = TransferView & { speed: number | null }`.

- [ ] **Step 1: Tests:** reducer upserts a view (new id appends, known id replaces, `done` from progress kept when a state event has lower `done`); `clearFinished` keeps everything but finished/cancelled; drawer shows groups "In progress", "Waiting", "Paused", "Failed", "Finished" in that order; paused row has "Resume backup.tar" button calling `onResume`; failed row "Retry report.pdf"; retrying row text "Connection dropped · Retrying in 8 s" (fake timers); header shows "Pause all" while something runs and "Resume all" when only paused remain; status bar summary "6 transfers · 38%".
- [ ] **Step 2–4:** fail, implement, pass (`npm test`, `npm run typecheck`). Speed: bytes per second over the last ~3 s of progress samples, kept in the hook; row text "48 MB/s · 31 s left".
- [ ] **Step 5:** Commit "Show waiting, paused and retrying transfers in the drawer".

## Phase 2 · Large files

### Task 8: Provider multipart and ranges

**Files:** Modify `providers/mod.rs`, `providers/s3.rs`, `testing.rs`, `commands/browse.rs` (for `list_keys` change).

**Interfaces:**
- Produces (spec §5.1): `ObjectInfo { size: u64, etag: String }`, `PartTarget<'a> { bucket: &'a str, key: &'a str, upload_id: &'a str }`, trait methods `head`, `start_multipart`, `put_part`, `complete_multipart`, `abort_multipart`, `get_range`; `KeyPage { objects: Vec<ObjectMeta>, next_token }` (was `keys`); `get_file` removed. S3: `put_part` streams `len` bytes from `offset` (`ByteStream::read_from().path().offset().length()`) with progress; `get_range` sends `Range: bytes=a-(b-1)` and `If-Match: etag`, opens the `.part` (must exist), seeks to `a`, writes; `PreconditionFailed` → `ObjectChanged`; `NoSuchUpload` → `AppError::Provider` with code kept so the worker can detect it (add `AppError::UploadGone`, kind `uploadGone`, message "The upload was cleaned up on the server. Kelp will start it again.").
- Fake: in-memory multipart (`start` returns `"up-1"`, parts stored, `complete` concatenates in number order), `get_range` honours etag, `set_etag(key, etag)` to simulate a change.

- [ ] **Step 1: Tests:** fake round trip of 3 parts out of order completes in order; `get_range` with a stale etag → `ObjectChanged`; s3 unit tests for request building where possible (range header text `bytes=0-8388607`); `delete_keys` still works with `KeyPage.objects`.
- [ ] **Step 2–4:** fail, implement, pass; move the worker's download path to a single `get_range` for the whole file (sizes ≤ 8 MiB) so `get_file` can go.
- [ ] **Step 5:** Commit "Add multipart uploads and ranged downloads to providers".

### Task 9: Big files in the worker

**Files:** Create `transfers/plan.rs` (part plan only now); modify `transfers/worker.rs`.

**Interfaces:**
- Produces: `pub const MULTIPART_THRESHOLD: u64 = 16 * MIB; pub const PART_SIZE: u64 = 8 * MIB; pub fn part_size(size: u64) -> u64; pub fn ranges(size: u64, part: u64) -> Vec<Range<u64>>` (part numbers are index + 1).
- Worker per item: upload over threshold → reuse `Resume::Upload` if `local_size`/`local_modified_ms` match the file, else abort the old upload (ignore its error) and `start_multipart`; save resume at once; send missing parts 4 at a time; `set_resume` after each part; `complete_multipart`; `UploadGone` → clear resume and start the item again once. Download → `head` (skip if resume etag present and `.part` exists), `set_len` on `.part`, fetch missing ranges 4 at a time, `set_resume` after each; `ObjectChanged` → delete `.part`, clear resume, start again once. Progress subtracts the bytes of a failed attempt so the bar never runs past 100%. Size 0 → `put_file` of an empty file / create an empty file, no ranges (Review Focus 1).

- [ ] **Step 1: Tests:** `part_size(16 MiB)` = 8 MiB; `part_size(100 GiB)` = 11 MiB (`ceil(107374182400/10000)` = 10737419 → rounded up to 11 MiB); `ranges(20 MiB, 8 MiB)` = `[0..8M, 8M..16M, 16M..20M]`; worker: 20 MiB upload sends 3 parts and the object equals the file; pause after the first part then resume sends only parts 2–3 (count `put_part` calls); local file rewritten while paused → `abort_multipart` called and all parts sent again (Review Focus 5); download with etag changed between ranges restarts and ends with the new bytes; zero-byte upload and download finish (Review Focus 1); cancel calls `abort_multipart` and deletes `.part`.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Upload and download big files in parts that survive pauses".

### Task 10: Real bucket check

**Files:** Create `app/src-tauri/tests/hetzner_transfer.rs` (copy `.env.test` loading from `hetzner_list.rs`).

- [ ] **Step 1:** `#[ignore = "needs real Hetzner keys in .env.test"]` test: write a 20 MiB temp file of patterned bytes, multipart upload to `kelp-test/<uuid>.bin` via `S3Provider` (start, 3 × `put_part`, complete), `head` size matches, ranged download into a `.part` of the same size, bytes equal, delete.
- [ ] **Step 2:** `cargo test` (ignored, compiles). If `.env.test` is present: `cargo test -- --ignored hetzner_transfer` passes.
- [ ] **Step 3:** Commit "Real-bucket test for multipart and ranged transfers".

## Phase 3 · Folders

### Task 11: Folder plans

**Files:** Modify `transfers/plan.rs`.

**Interfaces:**
- Produces: `pub fn walk_folder(root: &Path) -> Result<Vec<(PathBuf, String, u64)>, AppError>` (absolute path, relative path with `/`, size; recursive, skips symlinks and `.DS_Store`, sorted); `pub fn upload_items(root: &Path, prefix: &str) -> Result<Vec<Item>, AppError>` (key = `prefix + folder name + "/" + relative`); `pub fn download_target(prefix: &str, key: &str, dir: &Path) -> Option<PathBuf>` (None for any empty, `.` or `..` segment); `pub fn folder_name(prefix: &str) -> String` (last segment, or `"download"`).

- [ ] **Step 1: Tests:** walk of a temp tree `photos/a.jpg`, `photos/raw/b.dng`, `photos/.DS_Store`, a symlink → two items with keys `2026/photos/a.jpg`, `2026/photos/raw/b.dng`; `download_target("2026/photos/", "2026/photos/raw/b.dng", d)` = `d/raw/b.dng`; `"2026/photos/../x"`, `"2026/photos//x"`, `"2026/photos/./x"` → None (Review Focus 4).
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Plan folder uploads and downloads".

### Task 12: Folder commands

**Files:** Modify `commands/transfers.rs`, `lib.rs`; worker handles `Kind::Folder` items whose download target was None (failed at creation with "This name can't be saved on a Mac.") and keys ending in `/` (create the directory, mark done).

**Interfaces:**
- Produces: `plan_folder_upload(id, bucket, prefix, path) -> FolderPlan { files: u64, bytes: u64, existing: u64, examples: Vec<String> }`; `start_folder_upload(id, bucket, prefix, path, skip_existing: bool) -> Uuid`; `start_folder_download(id, bucket, prefix) -> Uuid` (unique folder in Downloads via `unique_download_path` on the folder name, created up front).

- [ ] **Step 1: Tests** (helpers, not Tauri commands): plan counts 2 files and finds 1 existing key with example; `skip_existing` leaves that item out; folder download of 3 keys incl. one unsafe → transfer with 2 Pending and 1 Failed item, ends Failed "1 file failed." with the two files on disk.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Upload and download whole folders".

### Task 13: Folder UI

**Files:** Modify `lib/tauri.ts`, `App.tsx`, `components/Toolbar.tsx`, `components/TransferDrawer.tsx` (+ test); create `components/OverwriteSheet.tsx` (+ test); `app.css`.

**Interfaces:**
- Consumes: Task 12. Produces: `api.pickFolder(): Promise<string | null>`, `api.planFolderUpload`, `api.startFolderUpload`, `api.startFolderDownload`; `OverwriteSheet({ plan, folderName, onCancel, onSkip, onReplace })`.

- [ ] **Step 1: Tests:** sheet title "38 of 1,204 files are already here", body `Uploading "photos" to media-archive/2026/ would replace them.`, three examples then "and 35 more", buttons "Cancel", "Skip 38 existing", "Replace 38 files"; Enter calls `onSkip`, Escape `onCancel`; drawer folder row "412 of 1,204 files · 3.1 GB of 9.8 GB" and "2 files failed" with a "Retry failed" button calling `onRetry`.
- [ ] **Step 2–4:** fail, implement, pass. Upload button opens a native menu "Upload files…" / "Upload a folder…"; context menu "Download N items" includes folders (folders call `startFolderDownload`).
- [ ] **Step 5:** Commit "Folder uploads and downloads in the window".

## Phase 4 · Size

### Task 14: Size counting core

**Files:** Create `app/src-tauri/src/usage.rs`, `commands/usage.rs`; modify `commands/mod.rs`, `lib.rs`.

**Interfaces:**
- Produces: `UsageResult { connection_id, bucket, prefix, bytes, objects, counted_at_ms: u64, complete: bool, resume_token: Option<String> }` (camelCase); `UsageStore` (`usage.json`, map by `"{id}/{bucket}/{prefix}"`, same safe write); `pub async fn count(provider, start: UsageResult, on_page: impl FnMut(&UsageResult)) -> Result<UsageResult, AppError>` (pages retry per Task 1); commands `get_usage`, `start_usage_count`, `cancel_usage_count`; event `usage://progress` ≤2/s plus a final one.

- [ ] **Step 1: Tests:** three pages of fake objects sum bytes and objects and end `complete` with no token; a count started from a saved partial result with a token continues and adds; store round-trip; starting twice for the same key runs one task.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit "Count bucket and folder size in the background".

### Task 15: Size in the status bar

**Files:** Modify `lib/tauri.ts`; create `hooks/useUsage.ts` (+ test); modify `components/StatusBar.tsx` (+ test), `components/BucketColumn.tsx`, `App.tsx`; `lib/format.ts` (+ test) for `formatCount` ("3.1 M", "2,400", "12 K") and `formatAge` ("3 h ago", "just now", "2 d ago").

- [ ] **Step 1: Tests:** status bar states exactly as spec §8 ("3 items · Calculate size", "Counting · 2.4 M files · 812 GB so far" + "Cancel", "1.2 TB · 3.1 M files · 3 h ago" + "Recalculate", "812 GB counted so far" + "Continue"); hook loads `getUsage` on place change and applies `usage://progress` only for its key; format helpers.
- [ ] **Step 2–4:** fail, implement, pass. "Calculate size" also in bucket context menu (bucket column) and folder row menu.
- [ ] **Step 5:** Commit "Show bucket and folder size in the status bar".

## Phase 5 · Finish

### Task 16: Docs and full check

**Files:** `SPEC.md` (M3 marked done; §5.4 command list and §5.5 numbers match; note R2 untested), `README.md` only if a command changed.

- [ ] **Step 1:** `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `npm test`, `npm run typecheck`, `npm run build` in `app/`.
- [ ] **Step 2:** Commit "Mark M3 done in the spec".
- [ ] **Step 3:** Hand the manual test list (spec §10) to the user; they run it on S3 and Hetzner.
