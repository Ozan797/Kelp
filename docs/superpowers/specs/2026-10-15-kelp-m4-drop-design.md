# Kelp M4, part 1: drag from Finder

Date: 2026-10-15
Status: approved in conversation (decisions below); written spec

## 1. Purpose

Drop files and folders from Finder onto Kelp to upload them: onto the open folder, onto a folder row, or onto a
bucket in the sidebar. Show where things will land before you let go. Reuse the M3 upload engine and overwrite
sheet; add no new dependency and no filesystem access for the UI.

Builds on the M3 spec (`2026-10-15-kelp-m3-transfers-design.md`): `upload_transfer`, `folder_upload_transfer`,
`plan_folder`, `OverwriteSheet`, the transfer queue.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Scope | Finder → Kelp only. Dragging between connections, moving within a bucket and dragging out to Finder are the next spec |
| Look | A's see-through dashed drop panel over the file list (fades in over 160 ms, none with Reduce motion) plus B's pill at the bottom carrying the message |
| Targets | The open folder (anywhere over the file list), a folder row, a bucket in the sidebar |
| Overwrites | One overwrite sheet for the whole drop, the M3 sheet. Return still chooses Skip |
| Upload picker | "Upload files…" and "Upload a folder…" use the same plan-then-ask flow, so picking 20 existing files asks once |
| Code comments | None (CLAUDE.md) |

## 3. What you see

| Pointer over | Panel | Highlight | Pill |
|---|---|---|---|
| File list, a file row, empty space in the list | Shown over the list | — | `Upload 3 files · 412 MB to vimeo/` |
| A folder row | Shown over the list | That row outlined in `--accent` (visible through the panel) | `Upload 3 files · 412 MB to vimeo/drafts/` |
| A bucket in the sidebar | Hidden | That bucket outlined | `Upload 3 files · 412 MB to old-site` |
| Anywhere else (rail, toolbar, no bucket open) | Hidden | — | `Drop on a folder or a bucket` |

- The destination in the pill is the path inside the bucket, ending in `/`; the bucket root is the bucket name.
- The pill counts what is dropped, from `inspect_drop`: `3 files · 412 MB`, `1 folder · 9.8 GB`,
  `1 folder and 2 files · 9.8 GB`. Until the count arrives it says `3 items`.
- The panel is `pointer-events: none`, uses `--accent` for the dashed border and a see-through accent fill, and is
  only shown while a bucket is open.
- `Escape` or dragging out of the window hides everything (`leave` event).

## 4. Flow

```
enter(paths, position)  → inspect_drop(paths) once, pick target from position
over(position)          → pick target from position
drop(paths, position)   → pick target; if none, do nothing
                        → plan_upload(id, bucket, prefix, paths)
                        → existing > 0 ? OverwriteSheet : start_uploads(skipExisting = false)
                        → Skip: start_uploads(true) · Replace: start_uploads(false) · Cancel: nothing
leave                   → clear
```

**Picking the target.** On macOS, Tauri's drop positions are labelled physical pixels but are already
points (CSS pixels) relative to the webview (wry builds them from AppKit's `draggingLocation`), so they go
straight into `document.elementFromPoint(x, y)?.closest("[data-drop]")`, with no `devicePixelRatio` division.
Drops are ignored while a sheet is open. Attributes:
`data-drop="folder"` + `data-key` on folder rows, `data-drop="bucket"` + `data-bucket` on bucket buttons,
`data-drop="list"` on the file list area. A folder target is `{ bucket: openBucket, prefix: key }`; a bucket target
is `{ bucket, prefix: "" }`; the list is the open place.

## 5. Backend

New, in `commands/transfers.rs` (helpers testable without Tauri, like M3):

```
inspect_drop(paths) -> DropSummary { files: u64, folders: u64, bytes: u64 }
plan_upload(id, bucket, prefix, paths) -> FolderPlan { files, bytes, existing, examples }
start_uploads(id, bucket, prefix, paths, skipExisting) -> Vec<Uuid>
```

- `inspect_drop` counts a file as one file with its size; a folder adds 1 to `folders` and its walked files to
  `files` and `bytes` (same walk as M3: no symlinks, no `.DS_Store`). Paths that don't exist are skipped. Runs the
  walk on a blocking thread.
- `plan_upload` builds every item (file → one item with key `prefix + name`; folder → `upload_items`), then checks
  existing keys per dropped path: a file checks its own key; a folder lists `prefix + name + "/"` once (never the
  whole destination, which could be a bucket root).
- `start_uploads` makes one file transfer per dropped file and one folder transfer per dropped folder, all through
  the queue. With `skipExisting`, existing files are left out (a dropped file that exists makes no transfer).
  Any file over 5 TiB refuses the whole call with `FileTooLarge`, before anything is queued.
- `plan_folder_upload` and `start_folder_upload` are removed (the UI no longer calls them), and so is `start_upload`.
  Their tests move to the new commands.

## 6. Frontend

- `lib/tauri.ts`: `DropSummary`, `api.inspectDrop`, `api.planUpload`, `api.startUploads`, and
  `api.onFileDrop(handler)` wrapping `getCurrentWebview().onDragDropEvent`.
- `lib/drop.ts` (pure): `dropTarget(element, openPlace) -> Target | null`, `dropSummaryText(summary, count)`,
  `pillText(summaryText, target)`, `destinationText(target)`.
- `hooks/useFileDrop.ts`: subscribes to drop events; state `{ paths, summary, target } | null`; calls
  `onDrop(paths, target)`.
- `components/DropOverlay.tsx`: the panel and the pill.
- `FileList` and `BucketColumn`: `data-drop` attributes and a `drop-target` class on the highlighted row or bucket.
- `OverwriteSheet`: `folderName` becomes `what` (`"photos"` in quotes for one item, `3 items` otherwise), so the
  body reads `Uploading "photos" to media-archive/2026/ would replace them.` or
  `Uploading 3 items to media-archive/2026/ would replace them.`
- `App`: one `uploadPaths(paths, target)` used by the drop, "Upload files…" and "Upload a folder…".
- CSS: `.drop-panel` (the see-through dashed panel with the fade), `.drop-pill`, `.drop-target`; semantic tokens only;
  `prefers-reduced-motion` turns the fade off.

## 7. Testing

- Rust: `inspect_drop` on a mixed drop (2 files, 1 folder with 2 files, 1 missing path); `plan_upload` with one
  existing file and one existing key inside a dropped folder; `start_uploads` with and without `skipExisting`
  (transfer count, item keys); a file over the limit refuses the call.
- Frontend: `dropTarget` for each attribute and for no target; pill and summary texts; `DropOverlay` states;
  `OverwriteSheet` with `what`; `App`: a drop on a folder row plans and starts uploads to that prefix, a drop with
  clashes shows the sheet, "Upload files…" with two existing files shows one sheet.
- Manual: drag files, a folder, and a mix onto the list, a folder row and a bucket; check Retina position.

## 8. Out of scope (next spec)

Dragging rows between connections (copy via this Mac), moving or copying within a bucket (server-side), dragging rows
out to Finder (needs a native drag plugin).
