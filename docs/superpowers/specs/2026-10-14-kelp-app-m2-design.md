# Kelp app screens and milestone M2

Date: 2026-10-14
Status: approved in conversation, awaiting written review

## 1. Purpose

Design the Kelp window once, for all milestones, and specify everything needed to build milestone M2:
saved connections, browsing buckets and folders, single-file upload and download, new folder, delete.
M3 (transfer queue) and M4 (preview, ⌘K, settings, drag and drop) slot into the same window later
without a redesign; they are sketched here, not specified.

Builds on: `SPEC.md` (sections 4, 5.3–5.8), the design system in `design/`, and the M1 code in
`app/src-tauri/src/` (`StorageProvider`, `S3Provider`, `ConnectionSettings`, `AppError`).

## 2. Decisions made

| Topic | Decision |
|---|---|
| Window layout | Three panes: connection rail, bucket column, file list (option B) |
| Rail | Real provider logos only; connection name on hover and to screen readers; selected tile outlined in accent |
| Add connection | One sheet; provider picker at the top, fields change with it; inline test result |
| Provider picker | Segmented control while there are 4 or fewer providers; becomes a dropdown beyond that |
| Saving | Only after a successful check. Bad keys are never saved |
| Context menu | Native macOS menu (Tauri menu API), not an HTML menu |
| Upload source | Native file picker. Drag and drop from Finder is M4 |
| Download target | `~/Downloads`, with "Show in Finder" in the drawer |
| Transfers UI | Drawer opened from the status bar; collapses to a slim bar; folding groups; scrolls |
| State management | Plain React state in small hooks; no state library |
| File list | Virtualised with TanStack Virtual |
| Code comments | None (CLAUDE.md) |

## 3. Window

```
┌──────┬───────────────┬──────────────────────────────────────────────┐
│ ●●●  │ Hetzner·media │ ‹ ›  media-archive / vimeo / 2025   [Filter] [New folder] [Upload] │
│ [H]  │  hel1         ├──────────────────────────────────────────────┤
│ [H]  │ ▣ media-arch… │ Name ▲                    Size    Modified     │
│ [C]  │ ▣ old-site    │ ▸ drafts                  —       Yesterday    │
│ [A]  │               │   launch-teaser.mp4       184 MB  Today 14:02  │
│  +   │               │   …                                            │
│      │               ├──────────────────────────────────────────────┤
│  ⚙   │               │ 7 items · 2 selected · 2.3 GB   (◌ Uploading 2 files · 64% ━━━) │
└──────┴───────────────┴──────────────────────────────────────────────┘
```

- Window: 1100×720 default, 760×480 minimum (already in `tauri.conf.json`). macOS traffic lights sit over the rail.
- Rail (72px): one 36px tile per saved connection with the provider logo in brand colour (`BrandLogo` paths,
  `--provider-*` tokens). Hover shows "Provider · name". "+" opens the connection sheet. Settings (⚙) at the bottom arrives with the settings window in M4; it is not rendered in M2.
- Bucket column (190px): connection name and location/region, then its buckets. Selected bucket uses
  `--accent-soft`. Hidden when there are no connections.
- Toolbar: back/forward (history of locations), breadcrumbs (each segment clickable), "Filter this folder"
  (filters rows already loaded, case-insensitive substring), New folder, Upload (primary).
- File list: 28px rows; folder icons in `--accent`, file icons by type (video, image, text, other) in
  `--text-muted`; columns Name, Size, Modified; click a header to sort (folders always first).
  Selection: click, ⌘-click, ⇧-click, ⌘A; selected rows `--accent-soft`; keyboard focus ring `--focus`.
  Double-click or Enter opens a folder; Backspace or ⌘↑ goes up.
- Context menu (native): Download N items…, Copy link… (M4), Rename… (M4), separator, Delete N items…
  Labels say exactly what they do; shortcuts right-aligned by macOS.
- Status bar: "N items · M selected · size"; while transfers run, a pill that opens the drawer.
- Fonts: `--font-ui` (system) for UI text, `--font-display` for empty-state headings, sizes 12–13px.
  Follows macOS light/dark. All colours from semantic tokens.

## 4. States

| State | What shows |
|---|---|
| First launch | Rail with only "+"; bucket column hidden; centred logo, "Welcome to Kelp", "Add a connection to browse your buckets on Amazon S3, Cloudflare R2 or Hetzner.", button **Add a connection**, link "Where do I find my keys?" (opens the docs site) |
| Loading a folder | Skeleton rows (`.skeleton`) shaped like real rows; status bar spinner "Loading files". Rows replace skeletons as each page of up to 1000 arrives; further pages load as the user scrolls near the end |
| Empty folder | "This folder is empty" / "Drop files here or choose Upload to add some." / **Upload files** |
| Keys stopped working | "This connection's keys no longer work" / "They may have been changed or revoked at your provider." / **Update keys** (opens the sheet in edit mode) and **Try again** |
| Other errors | `AppError` message as the body, with **Try again** |
| No buckets | "This connection has no buckets yet." (Kelp doesn't create buckets in M2) |

## 5. Connection sheet

- Opens from "+", the first-launch button, **Update keys**, and "Edit connection…" (rail tile context menu).
- Provider picker: Hetzner · R2 · AWS S3, with logos.
- Fields by provider:
  - Hetzner: Name, Location (fsn1 / nbg1 / hel1 menu; also accepts a pasted host), Access key, Secret key.
  - R2: Name, Account ID (endpoint is built from it), Access key, Secret key. Region is `auto`.
  - AWS S3: Name, Region (text with common suggestions), Access key, Secret key.
  - Advanced (collapsed): Endpoint override, Path-style addressing.
- Hint under the keys: where to find them for that provider, and **Open guide** (docs page).
- Buttons: **Test connection**, **Cancel**, **Save connection** (primary). Esc cancels.
- Validation (both buttons run it; Save writes only on success):
  1. Field checks first (name and keys not empty, location valid).
  2. `list_buckets`. Success shows "✓ Connected. Found N buckets."
  3. If the provider says AccessDenied for listing buckets, a **Bucket name** field appears:
     "This key can't list buckets. Enter the bucket you want to open." The check then lists that bucket;
     on success the bucket is stored on the profile and shown as its only bucket.
  4. Failures are shown inline under the relevant fields: wrong keys under the key fields, bad location
     under Location, network errors at the bottom. Nothing is saved.
- Editing: same sheet, filled in; empty Secret key keeps the stored one. Delete connection is in the rail tile
  context menu, with confirmation ("Delete the connection "media"? Your files aren't touched.").

## 6. Transfers drawer

- Opened from the status-bar pill; slides up over the file list; height resizable by dragging its top edge;
  ⌄ or Esc collapses it to a slim bar ("Uploading 2 files · 64% · 1 failed" plus progress) with ⌃ to expand.
- Header (fixed): "Transfers", summary, **Pause all**, **Clear finished**, collapse.
- Groups fold: In progress, Waiting, Failed, Finished, each with a count. Waiting and Finished start folded.
- Row: direction icon, name, destination, thin progress line, one status line ("64% · 45 s left"),
  actions on hover or keyboard focus (pause and cancel; Retry on failed; Show in Finder on finished downloads).
- M2 subset: In progress, Failed and Finished groups; cancel; Show in Finder. No waiting slots, pause, retry
  or Pause all (M3); those controls are not rendered in M2.

## 7. Front-end structure (`app/src/`)

```
lib/tauri.ts            typed wrappers for every command and event (the only place that calls invoke/listen)
hooks/useConnections.ts saved connections, add/edit/delete
hooks/useListing.ts     pages for (connection, bucket, prefix), loading, error, loadMore
hooks/useTransfers.ts   transfer list from events
components/Rail.tsx  BucketColumn.tsx  Toolbar.tsx  Breadcrumbs.tsx  FileList.tsx  StatusBar.tsx
components/TransferDrawer.tsx  ConnectionSheet.tsx  EmptyState.tsx  ErrorState.tsx  BrandLogo.tsx
App.tsx                 layout and current location (connection, bucket, prefix, history)
app.css                 window layout; components use semantic tokens only
```

`BrandLogo` reuses the same Simple Icons paths as the website (copied; the two projects stay independent).

## 8. Rust (`app/src-tauri/src/`)

```
profiles.rs             ConnectionProfile + ProfileStore (connections.json in the app data dir, atomic writes)
secrets.rs              SecretStore trait; KeychainStore (keyring crate, service "dev.ozanai.kelp", account = id); MemoryStore for tests
validation.rs           check_connection(provider, bucket_hint) -> CheckResult; pure flow, tested with a fake provider
state.rs                AppState: ProfileStore, SecretStore, provider cache (tokio Mutex<HashMap<Uuid, Arc<dyn StorageProvider>>>)
commands/connections.rs list_connections, test_connection, save_connection, delete_connection, set_last_location
commands/browse.rs      list_buckets, list_objects, create_folder, delete_objects
commands/transfers.rs   start_upload, start_download, cancel_transfer; events transfer://progress, transfer://state
```

- `ConnectionProfile`: `id: Uuid, name: String, settings: ConnectionSettings, bucket: Option<String>,
  last_location: Option<{ bucket, prefix }>`.
- `StorageProvider` gains `list_buckets`, `put_file(bucket, key, path, progress)`, `get_file(bucket, key, path, progress)`,
  `delete(bucket, keys)` (≤1000 per request) and `create_folder(bucket, prefix)`.
- Downloads write `name.part` and rename on completion; an existing file is never overwritten silently
  (a number is added: `name (1).ext`).
- Progress events are throttled to 10 per second per transfer.
- M2 transfers are single requests (S3 limit 5 GB). Larger files fail with a clear message until M3 adds multipart.
- Capabilities added: dialog open (file picker), opener reveal-in-dir and open-url limited to the docs site, menu (context menus). Nothing broader.
- `AppError` serialises as `{ kind, message }`; `kind` is camelCase of the variant (`badCredentials`, `accessDenied`, …).
  Add `NotListable` for "this key can't list buckets" so the sheet can show the Bucket name field.

## 9. Testing

- Rust unit: ProfileStore (temp dir, atomic write, no secrets in the JSON), validation flow with a fake provider
  and MemoryStore (success, bad keys, can't list buckets → bucket check, network), AppError kinds, progress
  throttling, download naming (`.part`, `name (1).ext`).
- Rust integration (ignored by default, real Hetzner from `.env.test`): list buckets, upload a small file to a
  `kelp-test-<timestamp>/` prefix, download it and compare bytes, delete it.
- Front end: Vitest + Testing Library for FileList (renders rows, sorting with folders first, selection
  rules, keyboard) and TransferDrawer (groups, folding, collapsed bar), with `lib/tauri.ts` mocked.
- Manual: wrong keys refuse to save; right keys save; browse, upload, download, new folder, delete with
  confirmation; quit and reopen returns to the last folder.
- Static reference: `design/reference/app.html` with the approved screens in dark and light.

## 10. Out of scope (later)

- M3: transfer queue (waiting slots, pause, resume, retries), multipart and ranged downloads, folder transfers.
- M4: preview pane (Space), ⌘K palette, tabs, settings window (theme override), drag and drop, rename, copy link.
- Bucket size counting (SPEC 5.8).
