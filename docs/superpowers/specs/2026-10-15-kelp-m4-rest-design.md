# Kelp M4, the rest: palette, preview, tabs, copy and move, settings

Date: 2026-10-15
Status: approved in conversation (mockups in `.superpowers/brainstorm/…/m4-rest.html`); written spec

## 1. Purpose

Finish M4 (SPEC §4): ⌘K command palette, quick preview, tabs, copy and move by dragging rows (within a
connection and to another one), and a Settings sheet with the theme. Also clear the six small issues left from
drag from Finder.

Builds on M3 (transfer engine, `transfers/`) and M4 part 1 (`2026-10-15-kelp-m4-drop-design.md`).

## 2. Decisions made

| Topic | Decision |
|---|---|
| Copy between connections | Drag rows onto another connection's tile in the rail; a sheet picks bucket and folder; runs as a transfer streamed through this Mac (pause, resume, retry) |
| Move within a connection | Drag rows onto a folder row, a breadcrumb, or a bucket of the same connection = **move** (server-side copy, then delete). Asks first: "Move 3 items (12 files) to drafts/?". Holding ⌥ = **copy**, no question |
| Preview | Quick Look overlay on Space; ← → step through files; Space / Esc close |
| Tabs | Strip above the toolbar, shown with 2+ tabs; each tab has its own connection, place, history, filter, sort, selection; ⌘T / ⌘W / ⌘⇧[ ]; not kept between launches |
| Settings | ⚙ in the rail opens a Settings sheet; Appearance: System / Light / Dark; also in ⌘K; saved |
| Analytics | Separate spec (`2026-10-15-kelp-analytics-design.md`), built after M4 |
| Code comments | None (CLAUDE.md) |

## 3. Drop polish (six fixes from the last review)

1. `useFileDrop` keeps the same state object on `over` when target and zone are unchanged (no re-render).
2. An `inspect_drop` answer only applies to the drag whose paths it was asked for.
3. `plan_upload` / `start_uploads` walk folders on a blocking thread (`spawn_blocking`); between letting go and
   the sheet or drawer, the pill stays as `Checking what's already in {destination}…`.
4. `DropSummary` gains `loose: u64` (dropped files that are not inside a dropped folder); the pill counts from it.
5. If `start_uploads` returns no transfers, the drawer stays shut and a note says
   `Nothing to upload. The folder is empty or everything is already there.`
6. A permanently mounted visually hidden `role="status"` region carries the pill text (the visible pill is
   `aria-hidden`), so screen readers announce changes.

## 4. Settings and theme

- `settings.json` in the app data folder: `{ "theme": "system" | "light" | "dark" }` (default `system`), same safe
  write as other stores. Commands `get_settings`, `set_settings`.
- The UI sets `document.documentElement.dataset.theme` to `light` / `dark`, or removes it for `system` (tokens
  already handle all three), and calls `getCurrentWindow().setTheme("light" | "dark" | null)` so the title bar
  matches. Capability added: `core:window:allow-set-theme` (one permission, needed for the title bar).
- Settings sheet (⚙, ⌘,): title `Settings`, note `Saved on this Mac.`, label `Appearance`, segmented
  `System` `Light` `Dark`, button `Done`. Changes apply at once.

## 5. ⌘K command palette

- Opens on ⌘K anywhere (not while another sheet is open); Esc closes; focus returns to where it was.
- One text field, a list below. Matching: case-insensitive; items whose label starts with the query rank above
  items that contain it; empty query shows actions first.
- **Places:** folders of the open listing (`📁 drafts · media-archive/vimeo/`), buckets of the open connection,
  connections (switch). Selecting navigates (connections switch the current tab).
- **Actions** (only those that apply now), with shortcuts shown right-aligned:

| Action | Shortcut |
|---|---|
| Upload files… / Upload a folder… | — |
| New folder… | ⌘⇧N |
| Download N items (selection) | ⌘D |
| Calculate size | — |
| Preview (focused file) | Space |
| New tab / Close tab | ⌘T / ⌘W |
| Pause all transfers / Resume all transfers | — |
| Show transfers | — |
| Theme: System / Light / Dark | — |
| Settings… | ⌘, |

- ↑↓ move, Return runs, mouse click runs. The list is a `listbox` with `aria-activedescendant`.
- All shortcuts above work without the palette too (ignored while typing in a field or with a sheet open).

## 6. Quick preview

- Space on the focused file (not a folder) opens the overlay; Space or Esc closes; ← → go to the previous or next
  file in the current sorted, filtered list (folders skipped).
- Header: name, `size · modified · N of M`, ‹ ›, **Download**, ✕.
- Content by kind (`fileKind` from `lib/format.ts`):
  - **image**, ≤ 50 MB: `<img>`.
  - **video**: `<video controls>`, streamed.
  - **text**: first 1 MB as plain text in `--font-mono`; if larger, a note `Showing the first 1 MB.`
  - anything else, or an image over 50 MB: `No preview for this kind of file.` with size and **Download**.
- **How bytes reach the window, without presigned URLs:** a Tauri URI scheme `kelp-preview://` registered in
  Rust (`register_asynchronous_uri_scheme_protocol`). URL: `kelp-preview://localhost/{connection}/{bucket}/{key…}`
  (each part percent-encoded). The handler looks up the connection's provider and answers with the object's bytes,
  honouring `Range` requests (206 with `Content-Range`) so video can seek; `Content-Type` from the extension.
  Only `GET`; unknown connection → 404. No URL ever contains a secret.
- CSP adds `kelp-preview:` to `img-src`, `media-src` and `connect-src` (text is fetched with `fetch`).
- Errors (network, access) show the `AppError` message in the overlay with **Try again**.

## 7. Tabs

- `App` keeps the rail, sheets, drawer, palette and settings; a new `Browser` component holds everything that
  is per tab today (bucket column contents, toolbar, listing, filter, sort, selection, history, size, drop target).
  `App` renders the strip and the active tab's `Browser`; inactive tabs are not mounted (their state lives in the
  tabs list).
- Tab state: `{ id, connectionId, history: Place[], position, filter, sort, selected: string[] }`.
- The strip shows only with 2+ tabs. Tab label: connection logo + `bucket / last folder` (or the connection name
  with no bucket open); full path in the tooltip. ✕ on hover and on the active tab.
- ⌘T opens a tab on the same connection and place; ⌘W closes (the last tab can't be closed); ⌘⇧] / ⌘⇧[ next /
  previous; clicking the rail switches the **current** tab's connection.
- Tabs are not saved between launches; the first tab opens like today (last location).

## 8. Copy and move by dragging rows

### 8.1 Dragging (UI)

- Pointer-based drag (no HTML5 drag and drop, so Tauri's file-drop handling is untouched): pressing on a selected
  row (or an unselected one, which selects it) and moving 4 px starts a drag of the selection. A small ghost
  follows the pointer: `🎞 2 items`.
- Targets, using the same `data-drop` attributes as file drops: folder rows (not one being dragged, not inside
  one being dragged), breadcrumb segments, buckets in the column (same connection), **connection tiles in the
  rail** (other connections only). The target is highlighted like a file drop.
- ⌥ held at drop time = copy; otherwise move (same connection). Onto a rail tile it is always a copy.
- Esc cancels the drag.
- Dropping onto the folder the rows are already in does nothing.

### 8.2 Confirming

- **Move (same connection):** sheet `Move 3 items to drafts/?` with body `12 files · 3.1 GB. They will be removed
  from vimeo/.` and buttons `Cancel` / `Move 3 items`. Return = Move is allowed (not destructive to the
  destination; the originals are removed only after each copy succeeds).
- **Copy (⌥, same connection):** no question, unless destination keys exist → the M3 overwrite sheet.
- **Copy to another connection:** the mockup sheet: `Copy 2 items to {Provider} · {name}`, body
  `{names or count} · {size}. They stay where they are.`, bucket list, `Into {bucket} / {folder} /` with
  `Change folder…` (a simple folder browser inside the sheet listing one level at a time), `Cancel` /
  `Copy N items`. Opens on the bucket and folder last used for that connection.
- Clashes at the destination (any copy or move) → the M3 overwrite sheet before anything starts.

### 8.3 Engine

- `Direction` gains `Copy`. `Transfer` gains `source: Option<Source>` with
  `Source { connection_id, bucket, move_after: bool }` (serde default `None`, so old `transfers.json` still loads).
  `Item` gains `source_key: Option<String>` (serde default). For copies, `key` is the destination key and
  `local` is unused.
- Planning (new `commands/copies.rs`): `plan_copy(from, bucket, keys, to, bucket, prefix)` → `FolderPlan`;
  `start_copy(…, skip_existing, move_after)` → transfer ids. A dragged folder lists every key under it (`list_all`)
  and keeps its own name under the destination prefix; refusing a folder into itself or its own subfolder with
  `AppError::InvalidSettings("A folder can't go inside itself.")`.
- Provider additions (S3 in `s3.rs`, fakes in `testing.rs`):

```rust
async fn copy_object(&self, from: &ObjectRef<'_>, to: &ObjectRef<'_>) -> Result<(), AppError>;           // ≤ 5 GiB
async fn copy_part(&self, target: &PartTarget<'_>, number: u32, from: &ObjectRef<'_>, range: Range<u64>)
    -> Result<String, AppError>;                                                                           // UploadPartCopy
async fn get_bytes(&self, bucket: &str, key: &str, etag: &str, range: Range<u64>) -> Result<Bytes, AppError>;
async fn put_part_bytes(&self, target: &PartTarget<'_>, number: u32, bytes: Bytes, progress: ProgressFn)
    -> Result<String, AppError>;
async fn put_bytes(&self, bucket: &str, key: &str, bytes: Bytes, progress: ProgressFn) -> Result<(), AppError>;
```

  `ObjectRef { bucket, key }`.
- Worker, per copy item:
  - **Same connection:** size ≤ 5 GiB → `copy_object`; larger → multipart with `copy_part` in 512 MiB ranges,
    resume data as uploads (`Resume::Upload` with the part list).
  - **Between connections:** `head` the source (size, etag), then size ≤ 16 MiB → `get_bytes` all + `put_bytes`;
    larger → multipart upload to the destination where each part is `get_bytes(range)` then `put_part_bytes`
    (8 MiB, part plan from M3, 4 parts at a time so at most 32 MiB per transfer is in memory). Resume as uploads;
    a changed source etag restarts the item.
  - **Move:** after an item's copy succeeds, delete its source key; a failed delete fails the item with the
    provider's message (the copy stays).
  - Retries, pause, cancel (aborts multipart), restart survival: as M3.
- Drawer: copies show `→` and `to {provider} · {bucket}/{prefix}`; moves say `Moved` when finished.
  After a move or copy finishes into the open folder, or out of it, the listing reloads.

## 9. Testing

- Rust: settings store; `kelp-preview` request parsing and `Range` handling (pure functions); `plan_copy` (folder
  keys, clashes, folder-into-itself); copy worker with the fake (same-connection small and large, cross-connection
  small and multipart, resume skips done parts, changed source etag restarts, move deletes only after success,
  failed delete fails the item); old `transfers.json` without the new fields loads.
- Frontend: palette ranking and actions; shortcuts ignored while typing; preview kinds, stepping, text cap note;
  tabs reducer (open, close, switch, per-tab state kept) and strip; row drag target picking and ⌥; move/copy sheets;
  settings sheet applies the theme; the six drop fixes.
- Manual: Retina drops; video seeking in preview; a 6 GB copy between Hetzner and S3 paused, quit, resumed;
  moving a folder of 1,000 files.

## 10. Build order (each a PR through CI)

1. Drop polish · 2. Settings and theme · 3. ⌘K palette and shortcuts · 4. Quick preview · 5. Tabs ·
6. Copy and move engine · 7. Row dragging, move and copy sheets · 8. SPEC update (M4 done).

## 11. Out of scope

Dragging rows out to Finder, rename (SPEC M4 lists "Rename…" in the menu sketch; left for later), copy link,
saving tabs between launches, bandwidth limits.
