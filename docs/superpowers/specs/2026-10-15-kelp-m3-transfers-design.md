# Kelp milestone M3: transfers and size

Date: 2026-10-15
Status: approved in conversation (decisions below); written spec for review

## 1. Purpose

Make transfers reliable for big work: a real queue with pause, resume, cancel and retry; files of any size
(multipart uploads, ranged parallel downloads); whole folders up and down; and bucket or folder size counted in
the background. Keep the design simple: one mechanism for pause, resume and restart, and one engine for files and
folders.

Builds on `SPEC.md` (4, 5.5, 5.6, 5.8), the M2 design (`2026-10-14-kelp-app-m2-design.md`) and the M2 code
(`commands/transfers.rs`, `transfers.rs`, `TransferDrawer.tsx`, `useTransfers.ts`).

## 2. Decisions made

| Topic | Decision |
|---|---|
| Restart | Unfinished transfers survive quitting. On launch, Waiting/Running/Retrying ones start by themselves; Paused stay paused |
| Engine shape | A pure, synchronous queue model plus a thin async runner (approach 1) |
| Drawer | Grouped by state (option A): In progress, Waiting, Paused, Failed, Finished |
| Folder in drawer | One row per folder: "412 of 1,204 files · 3.1 of 9.8 GB"; failed files show "N files failed · Retry failed" |
| Folder upload overwrites | Listed once before sending. If any clash, one sheet: **Cancel**, **Skip N existing** (default), **Replace N files** |
| Size | On request only, shown in the status bar (option B); core of SPEC 5.8 now |
| Size, later | "Include old versions and unfinished uploads", counting prefixes in parallel |
| Code comments | None (CLAUDE.md) |

## 3. Limits and numbers

| Name | Value |
|---|---|
| Transfers running at once | 4 |
| Requests in flight at once (all transfers) | 16 |
| Requests per transfer at once | 4 (parts of one big file, or files of one folder) |
| Multipart threshold | files over 16 MiB |
| Part size | 8 MiB, raised to `ceil(size / 10,000)` rounded up to 1 MiB for files over 80 GB (S3 allows 10,000 parts) |
| Largest file | 5 TiB (S3 object limit); larger fails with `FileTooLarge` |
| Download range size | 8 MiB |
| Retries | 5 attempts per part, range or small file; backoff 1, 2, 4, 8, 16 s (max 30 s) with jitter up to 50% |
| Saving `transfers.json` | at once on every status change; at most once a second otherwise |
| Progress events | at most 10 a second per transfer (unchanged) |
| Size progress events | at most 2 a second per count |

## 4. Model

A transfer is a list of **items**. A single-file transfer has one item; a folder transfer has one per file. The
engine only knows items, so files and folders share every code path.

```
Transfer {
  id: Uuid,
  connection_id: Uuid,
  direction: Upload | Download,
  kind: File | Folder,
  name: String,                 // file or folder name shown in the drawer
  bucket: String,
  local_root: PathBuf,          // upload: the picked file/folder; download: the target file/folder
  remote_root: String,          // upload: destination prefix; download: key or folder prefix
  status: Waiting | Running | Retrying { at_ms } | Paused | Failed | Finished | Cancelled,
  error: Option<AppError>,      // set when Failed
  items: Vec<Item>,
}

Item {
  local: PathBuf,               // absolute local path
  key: String,                  // full object key
  size: u64,
  state: Pending | Done | Failed(AppError),
  resume: Option<Resume>,
}

Resume =
  | Upload   { upload_id, part_size, parts: Vec<{ number, etag }>, local_size, local_modified_ms }
  | Download { etag, part_path, done_ranges: Vec<u32> }
```

**Status moves (pure functions in `queue.rs`):**

```
Waiting ──slot free──▶ Running ──all items done──▶ Finished (or Failed if any item failed)
Running ──retryable error──▶ Retrying{at} ──timer──▶ Running
Running ──permanent error / attempts used up──▶ item Failed; transfer goes on with other items
Waiting | Running | Retrying ──pause──▶ Paused ──resume──▶ Waiting
Failed ──retry──▶ failed items back to Pending, transfer Waiting
any ──cancel──▶ Cancelled (removed; cleanup below)
```

- **Pause is "stop the worker".** The worker task is aborted. Because each finished part and range is already in
  `Resume` and saved, resuming simply starts a new worker that skips what's done. A restart is the same as a
  resume. At most one part (8 MiB) per in-flight request is sent again.
- **A resume is trusted only if nothing changed.** Upload: the local file's size and modified time match, and the
  multipart upload still exists (else `NoSuchUpload`). Download: the object's ETag is unchanged (`If-Match` on every
  range request; a mismatch returns `PreconditionFailed`) and the `.part` file still exists. If any check fails,
  that item starts again from zero (the old multipart upload is aborted).
- **Cancel cleans up:** abort open multipart uploads, delete `.part` files. Completed files of a folder download stay.
- **Finished and Cancelled leave the engine** right after their event. The UI keeps finished rows until
  "Clear finished". Failed transfers stay (and are saved) until retried or dismissed with ✕.

## 5. Rust layout

`transfers.rs` becomes a folder:

```
src/transfers/
  mod.rs        public types re-exported
  model.rs      Transfer, Item, Resume, Status, TransferView (what the UI sees)
  queue.rs      pure: add, next_to_start(running), pause, resume, retry, cancel, restore_after_launch
  plan.rs       pure: part plan (part size, ranges), folder walk -> items, key/path mapping, safe names
  retry.rs      pure: is_retryable(&AppError), backoff(attempt, jitter)
  store.rs      transfers.json load/save (temp file + rename, like ProfileStore)
  paths.rs      today's download helpers (unique names, .part, finish_download)
  manager.rs    TransferManager: owns the queue, spawns/aborts workers, saves, emits events
  worker.rs     runs one transfer: items, parts, ranges, retries
src/usage.rs    size counting: UsageResult, usage.json, count loop
```

- `TransferManager` holds `tokio::sync::Mutex<Inner>` (queue, running task handles, store, save throttle) and a
  `Semaphore` of 16 for requests. Workers call small manager methods (`part_done`, `item_done`, `item_failed`,
  `progress`, `retrying`) that lock briefly and never across an `.await`.
- Events go through an `Emit` closure (`Arc<dyn Fn(Event) + Send + Sync>`), so tests capture events without Tauri.
- `AppError` gains `Busy` ("The storage provider is busy. Kelp will keep trying.") for `SlowDown`, `InternalError`,
  `ServiceUnavailable`, `RequestTimeout`; and `ObjectChanged` for `PreconditionFailed` (used internally to restart a
  download). `FileTooLarge` text becomes "This file is larger than 5 TB, the most S3 allows in one object."
  Retryable = `Network | Busy`.

### 5.1 Provider additions

`providers/` stays the only S3 code. New trait methods (S3 implementation in `s3.rs`, fakes in `testing.rs`):

```rust
async fn head(&self, bucket: &str, key: &str) -> Result<ObjectInfo, AppError>;          // size, etag
async fn start_multipart(&self, bucket: &str, key: &str) -> Result<String, AppError>;   // upload id
async fn put_part(&self, target: &PartTarget<'_>, number: u32, path: &Path, offset: u64, len: u64,
                  progress: ProgressFn) -> Result<String, AppError>;                     // etag
async fn complete_multipart(&self, target: &PartTarget<'_>, parts: &[CompletedPart]) -> Result<(), AppError>;
async fn abort_multipart(&self, target: &PartTarget<'_>) -> Result<(), AppError>;
async fn get_range(&self, bucket: &str, key: &str, etag: &str, range: Range<u64>, path: &Path,
                   progress: ProgressFn) -> Result<(), AppError>;                        // writes at range.start
```

`PartTarget { bucket, key, upload_id }`. `list_keys` returns `ObjectMeta` (key and size) instead of bare keys, so
folder downloads and size counting get sizes from the listing. `put_file` stays for small uploads; `get_file` is
removed (a small download is one range).

## 6. Flows

**Upload a file:** as today the UI calls `start_upload(replace)`; an existing key returns `AlreadyExists` and the UI
asks. Files over 16 MiB use multipart: `start_multipart` once (saved), then parts 4 at a time, each saved as it
completes, then `complete_multipart`.

**Download a file:** `head` (size, etag), reserve `~/Downloads/<name>` and its `.part` (existing helpers), set the
`.part` length, fetch 8 MiB ranges 4 at a time into place, rename on completion.

**Upload a folder:** `plan_folder_upload(id, bucket, prefix, path)` walks the folder (skips symlinks and
`.DS_Store`), lists keys under `prefix + folder/` once, and returns `{ files, bytes, existing, examples }` (examples:
first three clashing keys). If `existing > 0`, the UI shows the overwrite sheet. Then
`start_folder_upload(id, bucket, prefix, path, skip_existing)`. Keys use `/` and the folder's own name:
`prefix + "photos/raw/IMG_1.dng"`. Empty folders are not created.

**Download a folder:** `start_folder_download(id, bucket, prefix)` lists every key under the prefix, creates
`~/Downloads/<folder>` (or `<folder> (1)`), and maps each key to a path inside it. A key whose relative path has an
empty, `.` or `..` segment is skipped and reported as a failed item ("This name can't be saved on a Mac.").
Keys ending in `/` become empty folders.

**Retries:** each part, range or small file retries up to 5 times on `Network`/`Busy`. While a worker waits, the
transfer shows `Retrying` with the time of the next attempt. Other errors fail the item at once.

## 7. Commands and events

| Command | Returns |
|---|---|
| `list_transfers()` | `TransferView[]` (used on launch) |
| `start_upload(id, bucket, prefix, path, replace)` | transfer id (unchanged signature) |
| `start_download(id, bucket, key)` | transfer id (size now comes from `head`) |
| `plan_folder_upload(id, bucket, prefix, path)` | `{ files, bytes, existing, examples }` |
| `start_folder_upload(id, bucket, prefix, path, skipExisting)` | transfer id |
| `start_folder_download(id, bucket, prefix)` | transfer id |
| `pause_transfer(transfer)`, `resume_transfer(transfer)`, `retry_transfer(transfer)`, `cancel_transfer(transfer)` | `()` |
| `pause_all()`, `resume_all()` | `()` |
| `get_usage(id, bucket, prefix)` | `UsageResult \| null` |
| `start_usage_count(id, bucket, prefix)`, `cancel_usage_count(id, bucket, prefix)` | `()` |

`TransferView { id, direction, kind, name, destination, status, retryAt, total, done, filesTotal, filesDone,
filesFailed, error, path }`.

Events: `transfer://state` carries a full `TransferView` on every status change (the UI upserts it);
`transfer://progress` carries `{ id, done, total, filesDone }`; `usage://progress` carries a `UsageResult`.

## 8. Size counting

```
UsageResult { connectionId, bucket, prefix, bytes, objects, countedAt, complete, resumeToken }
```

- `start_usage_count` lists every object under the prefix with `list_keys` (1000 per page, no delimiter), adding
  sizes. Pages retry like transfers. One count per (connection, bucket, prefix); starting it again is a no-op.
- Results are saved in `usage.json` (map keyed by `connection/bucket/prefix`) after every page at most once a
  second, with the continuation token, so an interrupted count continues where it stopped.
- `usage://progress` twice a second; a final one with `complete: true`.
- Cancel stops the task and keeps the partial result (shown as interrupted).

**Status bar (option B):**

| State | Text |
|---|---|
| Never counted | `3 items · Calculate size` (link) |
| Counting | `3 items · ◌ Counting · 2.4 M files · 812 GB so far · Cancel` |
| Done | `3 items · 1.2 TB · 3.1 M files · 3 h ago · Recalculate` |
| Interrupted | `3 items · 812 GB counted so far · Continue` |

"Calculate size" is also in the context menu of a bucket (bucket column) and of a folder row.

## 9. UI changes

- `lib/tauri.ts`: new types and wrappers for every command above; `TransferStatus` gains `waiting`, `paused`,
  `retrying`.
- `useTransfers`: loads `list_transfers` on mount; `transfer://state` upserts the whole view.
- `TransferDrawer` (option A): groups In progress (running, retrying), Waiting, Paused, Failed, Finished.
  Row actions: Pause ⏸ and Cancel ✕ (running, retrying, waiting); Resume ▶ and ✕ (paused); Retry and ✕ (failed).
  Folder rows show "412 of 1,204 files · 3.1 of 9.8 GB" and, when some failed, "2 files failed · Retry failed".
  Retrying rows show "Connection dropped · Retrying in 8 s" in `--warning`. Running file rows show speed and time
  left, worked out in the UI from progress samples. Header: **Pause all** while anything is active, **Resume all**
  while everything left is paused, then **Clear finished**.
- `StatusBar`: transfer summary counts waiting too ("6 transfers · 38%"); the size text from section 8.
- Toolbar **Upload** opens a native menu: "Upload files…" and "Upload a folder…" (dialog `directory: true`;
  the existing `dialog:allow-open` permission covers it).
- File row context menu: "Download N items" now includes folders. Folder rows also get "Calculate size".
- `OverwriteSheet`: the approved sheet. Return chooses **Skip N existing**; Escape cancels.
- Every new string follows the UI copy rules (sentence case, buttons say what they do, no apologies).

## 10. Testing

- **Pure units (most of the logic):** queue moves (pause while retrying, cancel while waiting, retry failed items,
  restore after launch, never more than 4 running); part plan (threshold, 10,000-part limit, last part size);
  folder walk and key mapping; unsafe download names; backoff bounds; `is_retryable`; store round-trip and damaged
  file; usage sums and resume token.
- **Engine with a fake provider:** an in-memory `FakeProvider` with multipart and ranges and "fail the next N calls"
  switches. Tests: big upload completes with parts in order; pause then resume skips done parts; a network failure
  retries then succeeds; 6 failures fail the item; changed ETag restarts a download; cancel aborts the multipart
  upload and deletes `.part`; folder with one bad item ends Failed with the rest done.
- **Ignored real-bucket test** (`.env.test`, like `hetzner_list.rs`): 20 MiB multipart upload, ranged download,
  compare bytes, delete.
- **Frontend:** reducer upserts and statuses; drawer groups, actions and folder text; overwrite sheet buttons and
  keys; status bar size states. `lib/tauri.ts` mocked as today.
- **Manual pass before merging:** S3 and Hetzner (R2 when available): 6 GB upload paused, quit, reopened, resumed;
  folder of 1,000 files up and down; Wi-Fi off mid-transfer shows Retrying and recovers.

## 11. Build phases

1. **Queue engine:** model, queue, retry, store, manager, worker for small files; pause, resume, retry, cancel,
   restart restore; `list_transfers`; drawer groups and actions. M2 behaviour kept for small files.
2. **Large files:** provider multipart and ranges, resume data, part plan, trusted-resume checks.
3. **Folders:** walk and plan, folder upload with overwrite sheet, folder download, folder rows.
4. **Size:** `usage.rs`, commands, status bar and menus.
5. **Docs and checks:** update `SPEC.md` (M3 done, open items), README if needed, full test, clippy, fmt.

## 12. Out of scope (later)

Reordering the queue, bandwidth limits, per-transfer concurrency settings, transfers between two connections,
"include old versions" and parallel prefixes for size, a settings window, confirming quit while transfers run.
