# Update experience and "What's new" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kelp finds updates within ~30 minutes, shows them as a quiet status-bar indicator with a small card, and links to a "What's new" page on the website whose entries ship with every release.

**Architecture:** Release notes are plain data in `website/src/notes.ts`; the website renders them, and a small script reads them for the release workflow (summary for `latest.json`, Markdown for the draft release). In the app, `useUpdater` keeps update state once at the top of `App`, and an `UpdateStatus` component (indicator + card) sits at the right end of whichever status bar is showing.

**Tech Stack:** React 19 + TypeScript (Vitest) in `app/`; React 18 + Vite + `node --test --experimental-strip-types` in `website/`; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-17-kelp-update-experience-design.md` (mockup: `docs/superpowers/specs/assets/2026-10-17-update-indicator-mockup.html`)

## Global Constraints

- CLAUDE.md: no comments in new or changed code; strict TS, no `any`; Tauri calls only via `app/src/lib/tauri.ts`; semantic tokens only (no raw hex) in app and site CSS; visible focus; respect `prefers-reduced-motion`; sentence-case copy.
- Website: names and URLs in `config.ts`; a new page needs a `PAGES` entry and a `ROUTES` entry; page functions use no hooks; scenes use fake data only.
- No new Tauri capabilities. `https://kelp-dl.ozanai.dev/latest.json` never changes.
- Update checks: at launch, every `30 * 60 * 1000` ms, and on window focus when the last check was ≥ that long ago. Dev builds never check.
- App copy, verbatim:
  - indicator text `Update ready`, accessible name `Update ready, Kelp <version>`
  - card title `Kelp <version> is ready`, body = the release's summary, buttons `What's new` and `Restart to update`, close button accessible name `Close`
  - existing messages unchanged: `Kelp is up to date (<version>).`, `Kelp couldn't check for updates. Check your internet connection and try again.`, `Kelp couldn't install the update. Restart Kelp and try again.`, `Updates are off in development builds.`, and the restart confirmation.
- What's new link: `https://kelp.ozanai.dev/whats-new/#<version>` (opened with the existing `api.openDocs(path)`).
- Website page: path `/whats-new`, title `What's new – Kelp`, newest first, section `id="<version>"`, "Latest" label on the newest shown entry, only versions ≤ the live release.
- Commits: plain sentences, no trailers; never push.

## Review Focus

1. A Mac that slept overnight with Kelp open: bringing Kelp to the front checks at once — Task 5 `checks_on_focus_after_30_minutes`.
2. Dismissing 0.2.0 with ×, then 0.2.1 is published: the indicator comes back for 0.2.1 — Task 5 `a_newer_version_undoes_a_dismissal`.
3. A notes entry merged before Publish stays off the site — Task 1 `published_notes_stop_at_the_live_version`.
4. Version ordering beyond single digits (0.10.0 is newer than 0.9.0) — Task 1 `compares_versions_numerically`.
5. A user skipping several releases sees the newest summary and lands on its section — Task 5 `whats_new_opens_the_offered_version`.

---

### Task 1: Release notes data

**Files:**
- Create: `website/src/notes.ts`, `website/tests/notes.test.ts`, `website/scripts/release-notes.ts`
- Modify: `website/package.json` (`test` script: add `tests/notes.test.ts`)

**Interfaces:**
- Produces (in `website/src/notes.ts`, no imports, no JSX):
  - `export type Change = { title: string; body: string }`
  - `export type ReleaseNote = { version: string; date: string; summary: string; changes: readonly Change[]; scene?: "folder-memory" }` (`date` is ISO `YYYY-MM-DD`)
  - `export const RELEASE_NOTES: readonly ReleaseNote[]`, newest first
  - `export function compareVersions(a: string, b: string): number` (negative/zero/positive, numeric per part)
  - `export function noteFor(version: string, notes?: readonly ReleaseNote[]): ReleaseNote | null`
  - `export function publishedNotes(live: string | null, notes?: readonly ReleaseNote[]): ReleaseNote[]` (versions ≤ `live`; `[]` when `live` is null)
  - `export function releaseMarkdown(note: ReleaseNote): string` (summary line, blank line, `- **title** body` per change)
- CLI: `node --experimental-strip-types website/scripts/release-notes.ts <version> <outDir>` writes `<outDir>/summary.txt` and `<outDir>/body.md`; with no entry, prints `No release notes for <version>. Add an entry to website/src/notes.ts before tagging.` and exits 1.

- [ ] **Step 1: Write the failing tests** in `website/tests/notes.test.ts` (`node:test`, `assert/strict`), importing from `../src/notes.ts`:
  - `entries_are_newest_first_and_complete`: versions match `^\d+\.\d+\.\d+$`, are unique, strictly descending by `compareVersions`; every entry has a non-empty `summary`, at least one change, and a valid `date`.
  - `compares_versions_numerically`: `compareVersions("0.10.0", "0.9.0") > 0`, `compareVersions("1.0.0", "1.0.0") === 0`, `compareVersions("0.1.0", "0.1.1") < 0`.
  - `finds_a_version`: `noteFor("0.1.1")?.version === "0.1.1"`; `noteFor("9.9.9") === null`.
  - `published_notes_stop_at_the_live_version`: with a fixture `[0.2.0, 0.1.1, 0.1.0]`, `publishedNotes("0.1.1", fixture)` gives `["0.1.1", "0.1.0"]`; `publishedNotes(null, fixture)` gives `[]`.
  - `writes_markdown_for_the_draft_release`: for `{ summary: "S", changes: [{ title: "A", body: "a." }] }` the result is `"S\n\n- **A** a.\n"`.
- [ ] **Step 2:** `cd website && npm test` — FAIL (module not found).
- [ ] **Step 3: Implement `website/src/notes.ts`** with these two entries (copy is final):
  - `0.1.1`, `2026-10-17`, summary `Kelp now remembers where you were in each folder.`, scene `"folder-memory"`, changes:
    - `Back where you were` — `Go into a folder and back out, and the list is exactly where you left it, however many files it holds.`
    - `Folders open instantly` — `Folders you've visited this session appear at once, then refresh quietly in the background.`
  - `0.1.0`, `2026-10-16`, summary `The first release of Kelp.`, changes:
    - `S3, R2 and Hetzner in one app` — `Browse, upload, download, copy and move files across Amazon S3, Cloudflare R2 and Hetzner Object Storage.`
    - `Keys behind Touch ID` — `Your secret keys stay in the macOS Keychain, unlocked with Touch ID once per launch.`
    - `Fast, resumable transfers` — `Big files go up and down in parallel parts, pause and resume, and pick up where they stopped after a restart.`
    - `Updates itself` — `Kelp is signed and notarised by Apple and installs new versions with one click.`
- [ ] **Step 4: Implement the CLI** `website/scripts/release-notes.ts` using `noteFor` and `releaseMarkdown` (`process.argv`, `node:fs` `writeFileSync`).
- [ ] **Step 5:** `cd website && npm test` passes; `node --experimental-strip-types scripts/release-notes.ts 0.1.1 /tmp/kn && cat /tmp/kn/summary.txt` prints the 0.1.1 summary; `node --experimental-strip-types scripts/release-notes.ts 9.9.9 /tmp/kn; echo $?` prints the message and `1`.
- [ ] **Step 6: Commit** `Keep release notes as data the site and the release workflow both read`.

### Task 2: Release workflow uses the notes

**Files:** Modify `.github/workflows/release.yml`

**Interfaces:** Consumes the Task 1 CLI.

- [ ] **Step 1:** Add a step `Check the release notes` right after `Check the tag matches the app version`: `node --experimental-strip-types website/scripts/release-notes.ts "$VERSION" "$RUNNER_TEMP"`.
- [ ] **Step 2:** In `Write the update manifest`, delete the `git tag -l …` line and pass `"$RUNNER_TEMP/summary.txt"` to `manifest.mjs` as the notes file. In `Draft a GitHub release`, use `--notes-file "$RUNNER_TEMP/body.md"`. In `Read the version`, drop the tag fetch (`git -c http.extraheader=… fetch --force --tags` and its `GH_TOKEN` env), which nothing needs now. Add `summary.txt` and `body.md` to the `Remove signing files` cleanup.
- [ ] **Step 3:** Validate: `ruby -ryaml -e 'YAML.load_file(ARGV[0]); puts :ok' .github/workflows/release.yml`; and simulate the two new commands locally with `RUNNER_TEMP=/tmp/kr VERSION=0.1.1` (`mkdir -p /tmp/kr`), then `node app/scripts/manifest.mjs 0.1.1 <any non-empty file> /tmp/kr/summary.txt` prints JSON whose `notes` is the 0.1.1 summary.
- [ ] **Step 4: Commit** `Take release notes from the notes entry and stop a release that has none`.

### Task 3: "What's new" page

**Files:**
- Create: `website/src/pages/WhatsNew.tsx`
- Modify: `website/src/config.ts` (`PAGES` entry), `website/src/routes.tsx` (`ROUTES` entry), `website/src/components/Header.tsx` and `Footer.tsx` (link `What's new` next to Docs), `website/src/site.css`, `website/scripts/check-dist.mjs`

**Interfaces:**
- Consumes `publishedNotes`, `ReleaseNote` (Task 1), `RELEASE` from `config.ts`.
- Produces: `export const SCENES: Partial<Record<NonNullable<ReleaseNote["scene"]>, () => ReactElement>>` in `WhatsNew.tsx` (empty until Task 4), and the section markup `<section id={note.version}>` with an `<h2>` holding the version, a `<time dateTime={note.date}>` formatted like `17 October 2026`, and a `Latest` label on the first section.

- [ ] **Step 1:** Extend `check-dist.mjs`: when `dist/whats-new/index.html` exists and `process.env.KELP_RELEASE_VERSION` is set, require `id="<that version>"` in it, and fail if any section id is a version newer than it. `check-dist.mjs` runs under plain Node, so compare versions inline (split on `.`, compare numbers); don't import the `.ts` file.
- [ ] **Step 2:** `cd website && KELP_RELEASE_VERSION=0.1.1 npm run build` — FAIL (no `/whats-new` page).
- [ ] **Step 3:** Add the page: `PAGES` entry `{ path: "/whats-new", title: "What's new – Kelp", description: "What changed in each version of Kelp." }`, the route, and `WhatsNew()` (no hooks) using `ArticleLayout` like `Privacy`; heading `What's new in Kelp`; each published note as a section (scene from `SCENES` if present, then the changes as a list with bold titles). With no published notes: `The first release is on its way.` Styles use tokens only.
- [ ] **Step 4:** `KELP_RELEASE_VERSION=0.1.1 npm run build` passes and `grep -c 'id="0.1.1"' dist/whats-new/index.html` prints `1`; `KELP_RELEASE_VERSION=0.1.0 npm run build` passes and the page has no `id="0.1.1"`. `npm test` still passes.
- [ ] **Step 5: Commit** `Add a What's new page that lists each released version`.

### Task 4: The 0.1.1 scene

**Files:**
- Create: `website/src/components/FolderMemoryScene.tsx`
- Modify: `website/src/pages/WhatsNew.tsx` (`SCENES["folder-memory"]`), `website/src/site.css`, `website/src/data.ts` if new fake rows are needed

**Interfaces:** Consumes `SCENES` (Task 3). Produces `export function FolderMemoryScene(): ReactElement`.

- [ ] **Step 1: Implement the scene** as a small replica of Kelp's window reusing `DemoWindow`'s classes (`titlebar`, `list`, `list-head`, `row-icon folder/file`, `statusbar`, …) and fake data only. Loop (about 6 s): a folder list scrolled partway down, one folder row highlights and opens, its contents show, the back button highlights, the parent returns at the same scroll position (a brief accent outline on the row that was at the top). Start only when scrolled into view (`IntersectionObserver`); with `prefers-reduced-motion: reduce`, render the still frame of the scrolled list and don't animate. Hooks are fine here (child component).
- [ ] **Step 2: Verify:** `npm run build` (with `KELP_RELEASE_VERSION=0.1.1`) passes; `npm run dev`, open `/whats-new/#0.1.1`: the scene loops once visible, matches the landing demo's look in light and dark, and stays still with Reduce Motion on (System Settings → Accessibility → Display). `grep -riE "lovethework|hel1|AKIA" src/components/FolderMemoryScene.tsx src/data.ts` prints nothing.
- [ ] **Step 3: Commit** `Show the folder memory change as an animated scene`.

### Task 5: Update checks and the status-bar indicator

Part A changes the hook; Part B replaces the banner. They're one task because the app doesn't compile between them.

**Part A: `useUpdater` — 30-minute and on-focus checks, card state, dismissal**

**Files:**
- Modify: `app/src/hooks/useUpdater.ts`, `app/src/hooks/useUpdater.test.ts`, `app/src/lib/tauri.ts`

**Interfaces:**
- Consumes existing `api.checkForUpdate`, `api.appVersion`, `api.restartApp`, `api.onCheckForUpdates`, `api.confirm`.
- Produces:
  - `api.onWindowFocus(handler: () => void): Promise<UnlistenFn>` (via `getCurrentWindow().onFocusChanged`, calling `handler` when focused)
  - `CHECK_EVERY_MS = 30 * 60 * 1000`
  - `useUpdater(enabled: boolean): { ready: PendingUpdate | null; cardOpen: boolean; message: string | null; openCard(): void; closeCard(): void; dismiss(): void; checkNow(): void; restart(runningTransfers: number): Promise<void> }`
  - Rules: an automatic find sets `ready` (unless that version was dismissed) and leaves the card closed; `checkNow` always opens the card — with `ready` set (and any dismissal cleared) or with `message` (up to date / failed / dev); `closeCard` closes and clears `message`; `dismiss` remembers `ready.version`, clears `ready`, closes the card; a newer version than the dismissed one sets `ready` again; install failure sets `message` to the install-failed text and opens the card. `later`, `close` and `UpdaterState` are removed.

- [ ] **Step 1: Rewrite the tests** for the new shape (keep the existing single-in-flight, restart, confirm-cancel, install-failure and dev-build tests, adapted), and add:
  - `checks_every_30_minutes`: fake timers; after launch check, advancing `CHECK_EVERY_MS` triggers a second `checkForUpdate`.
  - `checks_on_focus_after_30_minutes`: capture the `onWindowFocus` handler. Right after the launch check, firing focus adds no check. Then simulate sleep — `vi.setSystemTime(Date.now() + CHECK_EVERY_MS + 60_000)` without advancing timers, so the interval doesn't fire — and fire focus: exactly one more `checkForUpdate` call.
  - `a_found_update_shows_the_indicator_not_the_card`: `ready.version === "0.2.0"`, `cardOpen === false`.
  - `check_now_opens_the_card`: with an update, `cardOpen` and `ready` set; with none, `message === "Kelp is up to date (0.1.0)."` and `cardOpen`.
  - `dismiss_hides_until_asked`: after `dismiss()`, a timed check finding 0.2.0 leaves `ready` null; `checkNow()` brings it back with the card open.
  - `a_newer_version_undoes_a_dismissal`: dismiss 0.2.0; a timed check finding 0.2.1 sets `ready.version === "0.2.1"`.
- [ ] **Step 2:** `cd app && npx vitest run src/hooks/useUpdater.test.ts` — FAIL.
- [ ] **Step 3: Implement** the hook and `api.onWindowFocus`; track the last check time in a ref so focus checks only when `Date.now() - last >= CHECK_EVERY_MS`.
- [ ] **Step 4:** the hook tests pass. `App.tsx` still uses the old shape, so don't commit yet; continue with the UI steps below in this same task.

**Part B: status-bar indicator and card**

**Files (Part B):**
- Create: `app/src/components/UpdateStatus.tsx`, `app/src/components/UpdateStatus.test.tsx`
- Modify: `app/src/components/StatusBar.tsx` (prop `update?: ReactNode`, rendered at the right-hand end after the transfers pill), `app/src/Browser.tsx` (prop `update: ReactNode` passed to its `StatusBar`), `app/src/App.tsx` (use the new hook shape; pass `update` to both status bars; remove `updateBanner`), `app/src/app.css`, `app/src/App.test.tsx` (mock `onWindowFocus`)
- Delete: `app/src/components/UpdateBanner.tsx`, `app/src/components/UpdateBanner.test.tsx`, the `.update-banner*` CSS

**Interfaces (Part B):**
- Consumes the Part A hook result and `api.openDocs`.
- Produces (Part B) `UpdateStatus({ updater, runningTransfers }: { updater: ReturnType<typeof useUpdater>; runningTransfers: number })`.

- [ ] **Step 5: Write the failing tests** in `UpdateStatus.test.tsx`:
  - `shows_nothing_without_an_update_or_message`.
  - `shows_the_indicator_when_an_update_is_ready`: a button named `Update ready, Kelp 0.2.0` with visible text `Update ready`; clicking calls `openCard`.
  - `the_card_shows_the_offered_version`: with `cardOpen`, a dialog-like region with `Kelp 0.2.0 is ready` and the summary; buttons `What's new`, `Restart to update`, `Close`.
  - `whats_new_opens_the_offered_version`: clicking `What's new` calls `api.openDocs("/whats-new/#0.2.0")`.
  - `restart_passes_the_running_transfers`: clicking `Restart to update` calls `restart(3)` when `runningTransfers` is 3.
  - `close_dismisses_the_update`: clicking `Close` calls `dismiss`.
  - `escape_closes_the_card_and_returns_focus`: Escape calls `closeCard`; focus is on the indicator after the card unmounts.
  - `a_message_card_has_only_close`: with `message` and no `ready`, the text shows, no `What's new`/`Restart to update`, and `Close` calls `closeCard`.
- [ ] **Step 6:** `npx vitest run src/components/UpdateStatus.test.tsx` — FAIL.
- [ ] **Step 7: Implement** `UpdateStatus` per spec §4: indicator = one `<button>` with an inline 14 px line download-arrow SVG (`aria-hidden`) in `--accent` and `Update ready` in status-bar text colour; one-time pulse class on first appearance, none under reduced motion; card positioned above the right-hand end of the status bar (wrapper `position: relative` in the status bar), Settings-sheet surface/border/radius/shadow tokens, ~320 px wide, buttons `white-space: nowrap`, × top-right; outside click closes. Wire into `StatusBar`, `Browser`, `App` (both status bars), and the ⌘K action keeps `updater.checkNow`.
- [ ] **Step 8:** `cd app && npm test && npm run typecheck` all pass; no act() warnings. Manual: `npm run tauri dev` → ⌘K → Check for updates… shows `Updates are off in development builds.` in the card above the status bar's right end; × closes it.
- [ ] **Step 9: Commit** `Check for updates every 30 minutes and show them as a quiet status-bar indicator`.

### Task 6: Release guide

**Files:** Modify `docs/RELEASING.md`, `CLAUDE.md`

- [ ] **Step 1:** In `docs/RELEASING.md` "Cut a release": add **Write the release notes** as the first step — read commits and merged PRs since the last tag (`git log --oneline v<last>..master`), add the entry at the top of `website/src/notes.ts` (version, today's date, a one-sentence summary for the app, 2–5 changes as bold title + one sentence, sentence case, plain words), add a scene in `website/src/components/` and `SCENES` when the main change is visual (fake data only), show the developer the entry and get approval; it goes in the same PR as the version bump. Change the tag step: the tag message is no longer the notes. Add the failure row: `No release notes for … Add an entry to website/src/notes.ts before tagging.` → add the entry, merge, delete and re-push the tag.
- [ ] **Step 2:** In `CLAUDE.md` Website section add: `Release notes live in website/src/notes.ts (plain data, newest first); the What's new page and the release workflow both read them.`
- [ ] **Step 3: Commit** `Make writing release notes part of every release`.
