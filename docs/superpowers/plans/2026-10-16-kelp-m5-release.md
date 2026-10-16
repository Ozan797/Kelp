# Signed releases, auto-update and the website — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `v*` tag builds a signed, notarised Kelp onto R2 without publishing it; a "Publish release" workflow makes it live for downloads, the auto-updater and the website.

**Architecture:** Two small tested Node scripts (version check, update manifest) feed a `release.yml` that runs the same `npm run tauri build` as local builds and uploads to R2 with the `aws` CLI. The app gains the updater and process plugins, wrapped in `lib/tauri.ts`, driven by a `useUpdater` hook and shown by an `UpdateBanner`. The website reads the live `latest.json` at build time instead of hand-edited version flags, and is deployed by a workflow that Publish also calls.

**Tech Stack:** Tauri 2 (`tauri-plugin-updater`, `tauri-plugin-process`), React 19 + TypeScript, Vitest, Node `node:test`, GitHub Actions, Cloudflare R2 + Pages (`wrangler`), `aws` CLI.

**Spec:** `docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`

## Global Constraints

- No comments, doc comments or file headers in new or changed code, workflows and scripts included (CLAUDE.md).
- Strict TypeScript, no `any`. Components never import Tauri packages; every plugin call goes through `app/src/lib/tauri.ts`.
- Never commit a Team ID, signing identity, Apple ID, email, key or token. Workflows read them only from `secrets.*`.
- Downloads host: `https://dl.kelp.ozanai.dev`. Bucket: `kelp-downloads`. Versioned path: `releases/<version>/`. Live files: `latest.json`, `Kelp_aarch64.dmg`.
- Update endpoint: `https://dl.kelp.ozanai.dev/latest.json`. Manifest platform key: `darwin-aarch64`. Update URL: `https://dl.kelp.ozanai.dev/releases/<version>/Kelp.app.tar.gz`.
- Capabilities may gain only `updater:default` and `process:allow-restart`.
- UI copy, verbatim:
  - Banner: `Kelp <version> is ready. Restart to update.` · buttons `Release notes`, `Later`, `Restart`
  - Up to date: `Kelp is up to date (<version>).`
  - Check failed: `Kelp couldn't check for updates. Check your internet connection and try again.`
  - Install failed: `Kelp couldn't install the update. Restart Kelp and try again.`
  - Dev builds: `Updates are off in development builds.`
  - Restart confirm: `1 transfer is running. Restart now? It'll resume after Kelp reopens.` / `<n> transfers are running. Restart now? They'll resume after Kelp reopens.` · confirm button `Restart`
  - Menu item and ⌘K action: `Check for updates…`
  - Version check failure: `Tag v<tag> doesn't match the app version in <file> (<version>)[, <file> (<version>)…]. Bump all three files, then tag again.`
  - Rebuild refusal: `<version> is already built. Bump the version for a new build.`
- Commits: plain sentences, no `Co-Authored-By` or other trailers. Never push.
- Commands: Rust in `app/src-tauri` (`cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`); app in `app/` (`npm test`, `npm run typecheck`); site in `website/` (`npm test`, `npm run build`).

## Review Focus

1. A manual "Check for updates…" while the 6-hour timer's check is already running must not start a second check or download — Task 4 `a_manual_check_during_a_timed_check_shares_it`.
2. "Later" must not be undone by the next timed check of the same version, but a manual check must bring it back — Task 4 `later_hides_the_same_version_until_asked`.
3. A failed install after Restart must say so instead of leaving the banner silently stuck — Task 4 `a_failed_install_says_so`.
4. A garbled or hostile `latest.json` (wrong types, missing version, `"version": "<script>"`) must make the site say "coming soon", never render it — Task 6 `rejects_anything_but_a_plain_version`.
5. A Publish with a version that has no build, or a version string with shell characters, must change nothing on R2 — Task 7, the validation step and its dry run.

## Before Task 3: one thing only the developer can do

Task 3 needs the updater's **public** key. Run once, choose a password, and save the private key file and password in a password manager:

```bash
cd app && npm run tauri signer generate -- -w ~/.tauri/kelp.key
```

This writes `~/.tauri/kelp.key` (private, never commit) and `~/.tauri/kelp.key.pub` (public, goes in `tauri.conf.json`). If `~/.tauri/kelp.key.pub` doesn't exist when Task 3 starts, the implementer stops with BLOCKED.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `app/scripts/version.mjs` (+ `.test.mjs`) | create | tag vs app version check |
| `app/scripts/manifest.mjs` (+ `.test.mjs`) | create | builds `latest.json` |
| `.github/workflows/release.yml` | rewrite | tag → build, sign, notarise, upload to R2, draft release |
| `app/src-tauri/Cargo.toml`, `src/lib.rs` | modify | updater + process plugins, "Check for updates…" menu item |
| `app/src-tauri/tauri.conf.json` | modify | updater endpoint and public key |
| `app/src-tauri/capabilities/default.json` | modify | two permissions |
| `app/package.json` | modify | two plugin packages |
| `app/src/lib/tauri.ts` | modify | `PendingUpdate`, `checkForUpdate`, `appVersion`, `restartApp`, `onCheckForUpdates` |
| `app/src/hooks/useUpdater.ts` (+ test) | create | update state machine and timers |
| `app/src/components/UpdateBanner.tsx` (+ test) | create | banner UI |
| `app/src/App.tsx`, `app/src/app.css` | modify | mount banner, ⌘K action, styles |
| `website/src/release.ts`, `website/tests/release.test.ts` | create | parse and fetch the live release |
| `website/vite.config.ts`, `src/config.ts`, `src/vite-env.d.ts`, `src/head.ts`, `src/components/DownloadButton.tsx`, `src/pages/Landing.tsx`, `package.json` | modify | release-driven version and download |
| `.github/workflows/publish.yml`, `.github/workflows/website.yml` | create | go live; deploy the site |
| `README.md`, `SPEC.md`, `CLAUDE.md`, `docs/STATUS.md` | modify | docs |

---

### Task 1: Release scripts (version check and manifest)

**Files:**
- Create: `app/scripts/version.mjs`, `app/scripts/version.test.mjs`
- Create: `app/scripts/manifest.mjs`, `app/scripts/manifest.test.mjs`

**Interfaces:**
- Produces: `node app/scripts/version.mjs <version>` exits 0 or prints the mismatch and exits 1. `node app/scripts/manifest.mjs <version> <sig file> <notes file>` prints the manifest JSON. Exports `versionMismatches(wanted, found)`, `cargoVersion(text)`, `manifest({ version, signature, notes, pubDate })`.

- [ ] **Step 1: Write the failing tests**

`app/scripts/version.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cargoVersion, versionMismatches } from "./version.mjs";

test("matching versions pass", () => {
  assert.deepEqual(versionMismatches("0.2.0", { "tauri.conf.json": "0.2.0", "Cargo.toml": "0.2.0", "package.json": "0.2.0" }), []);
});

test("every mismatching file is named with its version", () => {
  assert.deepEqual(versionMismatches("0.2.0", { "tauri.conf.json": "0.1.9", "Cargo.toml": "0.2.0", "package.json": "0.1.8" }), [
    "tauri.conf.json (0.1.9)",
    "package.json (0.1.8)",
  ]);
});

test("reads the package version from Cargo.toml, not a dependency's", () => {
  const text = '[package]\nname = "kelp"\nversion = "0.2.0"\n\n[dependencies]\nserde = { version = "1.0.0" }\n';
  assert.equal(cargoVersion(text), "0.2.0");
});
```

`app/scripts/manifest.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { manifest } from "./manifest.mjs";

test("builds the darwin-aarch64 manifest", () => {
  assert.deepEqual(manifest({ version: "0.2.0", signature: "c2lnbmF0dXJl\n", notes: "Faster previews\n", pubDate: "2026-10-20T10:00:00Z" }), {
    version: "0.2.0",
    notes: "Faster previews",
    pub_date: "2026-10-20T10:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: "c2lnbmF0dXJl",
        url: "https://dl.kelp.ozanai.dev/releases/0.2.0/Kelp.app.tar.gz",
      },
    },
  });
});

test("rejects a version that isn't x.y.z", () => {
  for (const version of ["v0.2.0", "0.2", "0.2.0-beta", "", "0.2.0; rm -rf /"]) {
    assert.throws(() => manifest({ version, signature: "s", notes: "", pubDate: "2026-10-20T10:00:00Z" }), /isn't a version like 0\.2\.0/);
  }
});

test("rejects an empty signature", () => {
  assert.throws(() => manifest({ version: "0.2.0", signature: " \n", notes: "", pubDate: "2026-10-20T10:00:00Z" }), /signature is empty/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && node --test scripts/version.test.mjs scripts/manifest.test.mjs`
Expected: FAIL, `Cannot find module './version.mjs'`.

- [ ] **Step 3: Implement**

`app/scripts/version.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function cargoVersion(text) {
  const packageSection = text.split(/^\[(?!package\])/m)[0];
  return packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

export function versionMismatches(wanted, found) {
  return Object.entries(found)
    .filter(([, version]) => version !== wanted)
    .map(([file, version]) => `${file} (${version})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv[2] ?? "";
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const found = {
    "tauri.conf.json": JSON.parse(read("../src-tauri/tauri.conf.json")).version,
    "Cargo.toml": cargoVersion(read("../src-tauri/Cargo.toml")),
    "package.json": JSON.parse(read("../package.json")).version,
  };
  const wrong = versionMismatches(wanted, found);
  if (wrong.length > 0) {
    console.error(`Tag v${wanted} doesn't match the app version in ${wrong.join(", ")}. Bump all three files, then tag again.`);
    process.exit(1);
  }
}
```

`app/scripts/manifest.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function manifest({ version, signature, notes, pubDate }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" isn't a version like 0.2.0.`);
  if (!signature.trim()) throw new Error("The update signature is empty.");
  return {
    version,
    notes: notes.trim(),
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": {
        signature: signature.trim(),
        url: `https://dl.kelp.ozanai.dev/releases/${version}/Kelp.app.tar.gz`,
      },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, signatureFile, notesFile] = process.argv.slice(2);
  try {
    const result = manifest({
      version: version ?? "",
      signature: readFileSync(signatureFile, "utf8"),
      notes: readFileSync(notesFile, "utf8"),
      pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run to see them pass, and try the CLIs**

Run: `cd app && node --test scripts/version.test.mjs scripts/manifest.test.mjs && node scripts/version.mjs 0.1.0; echo "exit $?"; node scripts/version.mjs 9.9.9; echo "exit $?"`
Expected: tests pass; `exit 0`; then the "Tag v9.9.9 doesn't match…" message naming all three files and `exit 1`. `npm test` also runs them (its glob is `scripts/*.test.mjs`).

- [ ] **Step 5: Commit**

```bash
git add app/scripts/version.mjs app/scripts/version.test.mjs app/scripts/manifest.mjs app/scripts/manifest.test.mjs
git commit -m "Add the release version check and update manifest scripts"
```

---

### Task 2: Release workflow

**Files:**
- Rewrite: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `app/scripts/version.mjs`, `app/scripts/manifest.mjs` (Task 1); `beforeBundleCommand` + `KELP_TEAM_ID` (part 1).
- Produces: on a `v*` tag, the four files under `s3://kelp-downloads/releases/<version>/` and a draft GitHub release.

- [ ] **Step 1: Write the workflow**

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  build:
    runs-on: macos-latest
    env:
      VERSION: ${{ github.ref_name }}
      R2_ENDPOINT: https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      AWS_DEFAULT_REGION: auto
      AWS_REQUEST_CHECKSUM_CALCULATION: when_required
      AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Read the version
        run: |
          git fetch --force --tags
          echo "VERSION=${VERSION#v}" >> "$GITHUB_ENV"
          echo "BUNDLE=app/src-tauri/target/aarch64-apple-darwin/release/bundle" >> "$GITHUB_ENV"

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: app/package-lock.json

      - name: Check the tag matches the app version
        run: node app/scripts/version.mjs "$VERSION"

      - name: Refuse to rebuild a published version
        run: |
          aws --version
          if aws s3 ls "s3://kelp-downloads/releases/$VERSION/" --endpoint-url "$R2_ENDPOINT" | grep -q .; then
            echo "$VERSION is already built. Bump the version for a new build."
            exit 1
          fi

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: "./app/src-tauri -> target"

      - run: npm ci
        working-directory: app

      - name: Write signing files
        env:
          KELP_PROVISION_PROFILE: ${{ secrets.KELP_PROVISION_PROFILE }}
          APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
        run: |
          echo "$KELP_PROVISION_PROFILE" | base64 --decode > app/src-tauri/Kelp.provisionprofile
          echo "$APPLE_API_KEY_P8" | base64 --decode > "$RUNNER_TEMP/AuthKey.p8"

      - name: Build, sign and notarise
        working-directory: app
        env:
          KELP_TEAM_ID: ${{ secrets.KELP_TEAM_ID }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY_PATH: ${{ runner.temp }}/AuthKey.p8
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: npm run tauri build -- --target aarch64-apple-darwin --config '{"bundle":{"createUpdaterArtifacts":true}}'

      - name: Write the update manifest
        run: |
          git tag -l --format='%(contents)' "v$VERSION" > "$RUNNER_TEMP/notes.txt"
          node app/scripts/manifest.mjs "$VERSION" "$BUNDLE/macos/Kelp.app.tar.gz.sig" "$RUNNER_TEMP/notes.txt" > "$RUNNER_TEMP/latest.json"

      - name: Upload to R2
        run: |
          for file in "$BUNDLE/dmg/Kelp_${VERSION}_aarch64.dmg" "$BUNDLE/macos/Kelp.app.tar.gz" "$BUNDLE/macos/Kelp.app.tar.gz.sig" "$RUNNER_TEMP/latest.json"; do
            aws s3 cp "$file" "s3://kelp-downloads/releases/$VERSION/" --endpoint-url "$R2_ENDPOINT"
          done

      - name: Draft a GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "v$VERSION" --draft --title "Kelp $VERSION" --notes-file "$RUNNER_TEMP/notes.txt" \
            "$BUNDLE/dmg/Kelp_${VERSION}_aarch64.dmg" "$BUNDLE/macos/Kelp.app.tar.gz" "$BUNDLE/macos/Kelp.app.tar.gz.sig" "$RUNNER_TEMP/latest.json"

      - name: Remove signing files
        if: always()
        run: rm -f app/src-tauri/Kelp.provisionprofile "$RUNNER_TEMP/AuthKey.p8" "$RUNNER_TEMP/latest.json"
```

- [ ] **Step 2: Lint it**

Run: `npx --yes actionlint@1 .github/workflows/release.yml` if it installs; otherwise `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))" && echo valid`.
Expected: no errors (actionlint may warn about unknown secrets; that's fine).

- [ ] **Step 3: Check the bundle paths a local build produces**

Run: `ls app/src-tauri/target/release/bundle/macos/ app/src-tauri/target/release/bundle/dmg/ 2>/dev/null`
Expected: `Kelp.app` and, if a `.dmg` was built locally, `Kelp_0.1.0_aarch64.dmg`, confirming the names the workflow uses (with `--target`, the same tree sits under `target/aarch64-apple-darwin/release/bundle`). If the local tree differs, match the workflow to it and note it in the report.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Build, sign and notarise tagged releases onto R2 without publishing them"
```

---

### Task 3: Updater and process plugins, and the menu item

**Files:**
- Modify: `app/src-tauri/Cargo.toml`, `app/src-tauri/src/lib.rs`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/capabilities/default.json`, `app/package.json` (+ lock files)

**Interfaces:**
- Produces: Rust registers both plugins; the Kelp menu has "Check for updates…" which emits the Tauri event `menu://check-updates` (no payload). npm packages `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` installed for Task 4.

- [ ] **Step 1: Check the prerequisite**

Run: `test -s ~/.tauri/kelp.key.pub && echo present`
Expected: `present`. Otherwise stop: BLOCKED, "run `npm run tauri signer generate -- -w ~/.tauri/kelp.key` first (plan, Before Task 3)".

- [ ] **Step 2: Add the dependencies**

```bash
cd app && npm install @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2
cd src-tauri && cargo add tauri-plugin-updater@2 tauri-plugin-process@2
```

- [ ] **Step 3: Register the plugins and the menu item**

In `app/src-tauri/src/lib.rs`, change `use tauri::menu::{MenuBuilder, SubmenuBuilder};` to `use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};`. In `run()`, after `.plugin(tauri_plugin_opener::init())` add:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_menu_event(|app, event| {
            if event.id() == "check-updates" {
                app.emit("menu://check-updates", ()).ok();
            }
        })
```

In `.setup`, before `let kelp = …`:

```rust
            let check_updates =
                MenuItemBuilder::with_id("check-updates", "Check for updates…").build(app)?;
```

and in the Kelp submenu change `.about(None)` to `.about(None).item(&check_updates)`.

- [ ] **Step 4: Configure the updater and permissions**

`app/src-tauri/tauri.conf.json`, add a top-level `"plugins"` object (the public key is the full contents of `~/.tauri/kelp.key.pub`, one line):

```json
  "plugins": {
    "updater": {
      "endpoints": ["https://dl.kelp.ozanai.dev/latest.json"],
      "pubkey": "<contents of ~/.tauri/kelp.key.pub>"
    }
  }
```

`app/src-tauri/capabilities/default.json`, add to `permissions` after `"opener:allow-reveal-item-in-dir",`:

```json
    "updater:default",
    "process:allow-restart",
```

- [ ] **Step 5: Build and check**

Run (in `app/src-tauri`): `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo clippy --release -- -D warnings && cargo test`
Expected: clean, all tests pass.
Run (in `app`): `grep -c "BEGIN\|PRIVATE" src-tauri/tauri.conf.json`
Expected: `0` (only the public key went in).

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/src/lib.rs app/src-tauri/tauri.conf.json app/src-tauri/capabilities/default.json
git commit -m "Add the updater and process plugins and a Check for updates menu item"
```

---

### Task 4: Update wrappers and the `useUpdater` hook

**Files:**
- Modify: `app/src/lib/tauri.ts`
- Create: `app/src/hooks/useUpdater.ts`, `app/src/hooks/useUpdater.test.ts`

**Interfaces:**
- Consumes: the npm plugins and `menu://check-updates` (Task 3); existing `api.confirm(message, okLabel): Promise<boolean>`.
- Produces:
  - `export type PendingUpdate = { version: string; notes: string; install: () => Promise<void> }`
  - `api.checkForUpdate(): Promise<PendingUpdate | null>` (checks and downloads), `api.appVersion(): Promise<string>`, `api.restartApp(): Promise<void>`, `api.onCheckForUpdates(handler: () => void): Promise<UnlistenFn>`
  - `export type UpdaterState = { kind: "idle" } | { kind: "ready"; update: PendingUpdate } | { kind: "message"; text: string }`
  - `useUpdater(enabled: boolean): { state: UpdaterState; checkNow: () => void; later: () => void; close: () => void; restart: (runningTransfers: number) => Promise<void> }`
  - exported constants `CHECK_EVERY_MS`, `UPDATES_OFF`, `CHECK_FAILED`, `INSTALL_FAILED`, functions `upToDate(version)`, `restartQuestion(count)`

- [ ] **Step 1: Add the wrappers**

In `app/src/lib/tauri.ts`, add imports:

```ts
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
```

add the type next to the other exported types:

```ts
export type PendingUpdate = { version: string; notes: string; install: () => Promise<void> };
```

and these entries to the `api` object (after `onTransferState`):

```ts
  checkForUpdate: async (): Promise<PendingUpdate | null> => {
    const update = await check();
    if (update === null) return null;
    await update.download();
    return { version: update.version, notes: update.body ?? "", install: () => update.install() };
  },
  appVersion: () => getVersion(),
  restartApp: () => relaunch(),
  onCheckForUpdates: (handler: () => void): Promise<UnlistenFn> => listen("menu://check-updates", () => handler()),
```

Run: `cd app && npm run typecheck`. If `download`/`install` don't exist on `Update` in the installed plugin version, read `node_modules/@tauri-apps/plugin-updater/dist-js/index.d.ts` and report NEEDS_CONTEXT with what it offers.

- [ ] **Step 2: Write the failing hook tests**

`app/src/hooks/useUpdater.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PendingUpdate } from "../lib/tauri";
import { CHECK_EVERY_MS, CHECK_FAILED, INSTALL_FAILED, UPDATES_OFF, restartQuestion, upToDate, useUpdater } from "./useUpdater";

const pending = (version: string, install = vi.fn(async () => undefined)): PendingUpdate => ({ version, notes: "Notes", install });

let menuCheck: () => void = () => undefined;

beforeEach(() => {
  vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
  vi.spyOn(api, "restartApp").mockResolvedValue(undefined);
  vi.spyOn(api, "onCheckForUpdates").mockImplementation(async (handler) => {
    menuCheck = handler;
    return () => undefined;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useUpdater", () => {
  it("shows a found update after the launch check", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", update: { version: "0.2.0" } }));
  });

  it("stays quiet when a timed check finds nothing or fails", async () => {
    const found = vi.spyOn(api, "checkForUpdate").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    expect(found).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("answers a manual check that finds nothing", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(api.checkForUpdate).toHaveBeenCalled());
    act(() => result.current.checkNow());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "message", text: upToDate("0.1.0") }));
  });

  it("answers a manual check that fails, and the menu item does the same", async () => {
    vi.spyOn(api, "checkForUpdate").mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(api.onCheckForUpdates).toHaveBeenCalled());
    act(() => menuCheck());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "message", text: CHECK_FAILED }));
  });

  it("a_manual_check_during_a_timed_check_shares_it", async () => {
    let finish: (value: PendingUpdate | null) => void = () => undefined;
    const found = vi.spyOn(api, "checkForUpdate").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    act(() => result.current.checkNow());
    await act(async () => finish(pending("0.2.0")));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(found).toHaveBeenCalledTimes(1);
  });

  it("later_hides_the_same_version_until_asked", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    act(() => result.current.later());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    expect(result.current.state).toEqual({ kind: "idle" });
    act(() => result.current.checkNow());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
  });

  it("restarts after installing", async () => {
    const install = vi.fn(async () => undefined);
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", install));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(() => result.current.restart(0));
    expect(install).toHaveBeenCalled();
    expect(api.restartApp).toHaveBeenCalled();
  });

  it("asks before restarting while transfers run, and respects Cancel", async () => {
    const install = vi.fn(async () => undefined);
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", install));
    const confirm = vi.spyOn(api, "confirm").mockResolvedValue(false);
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(() => result.current.restart(3));
    expect(confirm).toHaveBeenCalledWith(restartQuestion(3), "Restart");
    expect(install).not.toHaveBeenCalled();
  });

  it("a_failed_install_says_so", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", vi.fn(async () => Promise.reject(new Error("disk")))));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(() => result.current.restart(0));
    expect(result.current.state).toEqual({ kind: "message", text: INSTALL_FAILED });
    expect(api.restartApp).not.toHaveBeenCalled();
  });

  it("never checks in development builds and says so when asked", async () => {
    const found = vi.spyOn(api, "checkForUpdate");
    const { result } = renderHook(() => useUpdater(false));
    act(() => result.current.checkNow());
    expect(result.current.state).toEqual({ kind: "message", text: UPDATES_OFF });
    expect(found).not.toHaveBeenCalled();
  });

  it("words the restart question for one and many transfers", () => {
    expect(restartQuestion(1)).toBe("1 transfer is running. Restart now? It'll resume after Kelp reopens.");
    expect(restartQuestion(3)).toBe("3 transfers are running. Restart now? They'll resume after Kelp reopens.");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd app && npx vitest run src/hooks/useUpdater.test.ts`
Expected: FAIL, cannot resolve `./useUpdater`.

- [ ] **Step 4: Implement**

`app/src/hooks/useUpdater.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PendingUpdate } from "../lib/tauri";

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const UPDATES_OFF = "Updates are off in development builds.";
export const CHECK_FAILED = "Kelp couldn't check for updates. Check your internet connection and try again.";
export const INSTALL_FAILED = "Kelp couldn't install the update. Restart Kelp and try again.";
export const upToDate = (version: string) => `Kelp is up to date (${version}).`;
export const restartQuestion = (count: number) =>
  count === 1
    ? "1 transfer is running. Restart now? It'll resume after Kelp reopens."
    : `${count} transfers are running. Restart now? They'll resume after Kelp reopens.`;

export type UpdaterState = { kind: "idle" } | { kind: "ready"; update: PendingUpdate } | { kind: "message"; text: string };

export function useUpdater(enabled: boolean) {
  const [state, setState] = useState<UpdaterState>({ kind: "idle" });
  const inFlight = useRef<Promise<PendingUpdate | null> | null>(null);
  const ready = useRef<PendingUpdate | null>(null);
  const hidden = useRef<string | null>(null);

  const find = useCallback(() => {
    inFlight.current ??= api.checkForUpdate().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  const check = useCallback(
    async (manual: boolean) => {
      if (!enabled) {
        if (manual) setState({ kind: "message", text: UPDATES_OFF });
        return;
      }
      try {
        const update = ready.current ?? (await find());
        if (update) {
          ready.current = update;
          if (manual || hidden.current !== update.version) setState({ kind: "ready", update });
          return;
        }
        if (manual) setState({ kind: "message", text: upToDate(await api.appVersion()) });
      } catch {
        if (manual) setState({ kind: "message", text: CHECK_FAILED });
      }
    },
    [enabled, find],
  );

  useEffect(() => {
    void check(false);
    const timer = setInterval(() => void check(false), CHECK_EVERY_MS);
    const stop = api.onCheckForUpdates(() => void check(true));
    return () => {
      clearInterval(timer);
      void stop.then((unlisten) => unlisten());
    };
  }, [check]);

  const later = useCallback(() => {
    hidden.current = ready.current?.version ?? null;
    setState({ kind: "idle" });
  }, []);

  const close = useCallback(() => setState({ kind: "idle" }), []);

  const restart = useCallback(async (runningTransfers: number) => {
    const update = ready.current;
    if (!update) return;
    if (runningTransfers > 0 && !(await api.confirm(restartQuestion(runningTransfers), "Restart"))) return;
    try {
      await update.install();
      await api.restartApp();
    } catch {
      setState({ kind: "message", text: INSTALL_FAILED });
    }
  }, []);

  return { state, checkNow: () => void check(true), later, close, restart };
}
```

- [ ] **Step 5: Run to see them pass**

Run: `cd app && npx vitest run src/hooks/useUpdater.test.ts && npm run typecheck`
Expected: all pass. If a fake-timer test is flaky, fix the test's timer handling, not the hook's behaviour, and say so in the report.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/tauri.ts app/src/hooks/useUpdater.ts app/src/hooks/useUpdater.test.ts
git commit -m "Check for, download and install updates through a single in-flight check"
```

---

### Task 5: Update banner in the app

**Files:**
- Create: `app/src/components/UpdateBanner.tsx`, `app/src/components/UpdateBanner.test.tsx`
- Modify: `app/src/App.tsx`, `app/src/app.css`, `app/src/App.test.tsx` (mock additions only)

**Interfaces:**
- Consumes: `useUpdater`, `UpdaterState` (Task 4); `transfers` from `useTransfers()` in `App.tsx`.
- Produces: `UpdateBanner({ state, onRestart, onLater, onClose })`.

- [ ] **Step 1: Write the failing component tests**

`app/src/components/UpdateBanner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

const ready = { kind: "ready" as const, update: { version: "0.2.0", notes: "Faster previews", install: async () => undefined } };
const handlers = () => ({ onRestart: vi.fn(), onLater: vi.fn(), onClose: vi.fn() });

describe("UpdateBanner", () => {
  it("shows nothing when idle", () => {
    const { container } = render(<UpdateBanner state={{ kind: "idle" }} {...handlers()} />);
    expect(container.textContent).toBe("");
  });

  it("offers a ready update with notes on request", async () => {
    const on = handlers();
    render(<UpdateBanner state={ready} {...on} />);
    expect(screen.getByRole("status").textContent).toContain("Kelp 0.2.0 is ready. Restart to update.");
    expect(screen.queryByText("Faster previews")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Release notes" }));
    expect(screen.getByText("Faster previews")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(on.onLater).toHaveBeenCalled();
    expect(on.onRestart).toHaveBeenCalled();
  });

  it("hides Release notes when there are none", () => {
    render(<UpdateBanner state={{ kind: "ready", update: { ...ready.update, notes: "" } }} {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Release notes" })).toBeNull();
  });

  it("shows a message with a Close button", async () => {
    const on = handlers();
    render(<UpdateBanner state={{ kind: "message", text: "Kelp is up to date (0.2.0)." }} {...on} />);
    expect(screen.getByRole("status").textContent).toContain("Kelp is up to date (0.2.0).");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(on.onClose).toHaveBeenCalled();
  });
});
```

Run: `cd app && npx vitest run src/components/UpdateBanner.test.tsx`
Expected: FAIL, cannot resolve `./UpdateBanner`.

- [ ] **Step 2: Implement the banner**

`app/src/components/UpdateBanner.tsx`:

```tsx
import { useState } from "react";
import type { UpdaterState } from "../hooks/useUpdater";

type UpdateBannerProps = {
  state: UpdaterState;
  onRestart: () => void;
  onLater: () => void;
  onClose: () => void;
};

export function UpdateBanner({ state, onRestart, onLater, onClose }: UpdateBannerProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  if (state.kind === "idle") return null;
  if (state.kind === "message") {
    return (
      <div className="update-banner" role="status">
        <span className="update-text">{state.text}</span>
        <button type="button" className="button button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  const { version, notes } = state.update;
  return (
    <div className="update-banner" role="status">
      <span className="update-text">Kelp {version} is ready. Restart to update.</span>
      {notes && (
        <button type="button" className="button button-ghost" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>
          Release notes
        </button>
      )}
      <button type="button" className="button button-secondary" onClick={onLater}>
        Later
      </button>
      <button type="button" className="button button-primary" onClick={onRestart}>
        Restart
      </button>
      {notesOpen && <p className="update-notes">{notes}</p>}
    </div>
  );
}
```

`app/src/app.css`, after the `.action-error` rules:

```css
.update-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text);
  font-size: 12px;
}

.update-banner .button {
  min-height: 28px;
  font: 600 12px / 1 var(--font-ui);
}

.update-text {
  flex: 1 1 auto;
}

.update-notes {
  flex-basis: 100%;
  margin: 0;
  color: var(--text-muted);
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Mount it in the app**

In `app/src/App.tsx`:
- import `useUpdater` and `UpdateBanner`;
- after `const { transfers, clearFinished } = useTransfers();` add:

```tsx
  const updater = useUpdater(!import.meta.env.DEV);
  const runningTransfers = transfers.filter((t) => t.status === "running" || t.status === "waiting" || t.status === "retrying").length;
```

- in `appCommands()`, before the `settings` action, add `action("check-updates", "Check for updates…", updater.checkNow);`
- render `<UpdateBanner state={updater.state} onRestart={() => void updater.restart(runningTransfers)} onLater={updater.later} onClose={updater.close} />` directly before the existing `action-error` element, in the same place in the layout.

In `app/src/App.test.tsx`, the mocked `api` must gain `checkForUpdate: vi.fn(async () => null)`, `appVersion: vi.fn(async () => "0.1.0")`, `restartApp: vi.fn(async () => undefined)`, `onCheckForUpdates: vi.fn(async () => () => undefined)` wherever the test's `api` object is defined. Change nothing else in that file.

- [ ] **Step 4: Run everything**

Run: `cd app && npm test && npm run typecheck`
Expected: all pass, output free of React act() warnings from the new code.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/UpdateBanner.tsx app/src/components/UpdateBanner.test.tsx app/src/App.tsx app/src/app.css app/src/App.test.tsx
git commit -m "Show a ready update in a banner with release notes, Later and Restart"
```

---

### Task 6: Website reads the live release

**Files:**
- Create: `website/src/release.ts`, `website/tests/release.test.ts`, `website/src/vite-env.d.ts`
- Modify: `website/vite.config.ts`, `website/src/config.ts`, `website/src/head.ts`, `website/src/components/DownloadButton.tsx`, `website/src/pages/Landing.tsx`, `website/package.json`

**Interfaces:**
- Produces: `export type Release = { version: string }`, `parseRelease(json: unknown): Release | null`, `fetchRelease(): Promise<Release | null>`; build-time constant `__KELP_RELEASE__`; `config.ts` exports `RELEASE: Release | null` and `DOWNLOAD_URL = "https://dl.kelp.ozanai.dev/Kelp_aarch64.dmg"`; `SITE.version` and `SITE.released` no longer exist.

- [ ] **Step 1: Write the failing test**

`website/tests/release.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelease } from "../src/release.ts";

test("reads the version from a manifest", () => {
  assert.deepEqual(parseRelease({ version: "0.2.0", notes: "x", platforms: {} }), { version: "0.2.0" });
});

test("rejects_anything_but_a_plain_version", () => {
  for (const json of [null, "0.2.0", 42, {}, { version: 2 }, { version: "" }, { version: "v0.2.0" }, { version: "<script>alert(1)</script>" }, { version: "0.2.0 beta" }]) {
    assert.equal(parseRelease(json), null, JSON.stringify(json));
  }
});
```

In `website/package.json`, change the `test` script's file list from `tests/path.test.ts` to `tests/path.test.ts tests/release.test.ts`.

Run: `cd website && npm test`
Expected: FAIL, cannot find `../src/release.ts`.

- [ ] **Step 2: Implement the release module**

`website/src/release.ts`:

```ts
export type Release = { version: string };

const MANIFEST_URL = "https://dl.kelp.ozanai.dev/latest.json";

export function parseRelease(json: unknown): Release | null {
  if (typeof json !== "object" || json === null) return null;
  const version = (json as { version?: unknown }).version;
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? { version } : null;
}

export async function fetchRelease(): Promise<Release | null> {
  try {
    const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(5000) });
    return response.ok ? parseRelease(await response.json()) : null;
  } catch {
    return null;
  }
}
```

`website/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

declare const __KELP_RELEASE__: import("./release").Release | null;
```

`website/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fetchRelease } from "./src/release";

export default defineConfig(async () => ({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  define: { __KELP_RELEASE__: JSON.stringify(await fetchRelease()) },
}));
```

(The old comment above `server` is dropped with the rewrite, per the no-comments rule for changed code.)

- [ ] **Step 3: Use it in the site**

`website/src/config.ts`: remove the `version` and `released` lines (and the comment above `released`) from `SITE`; replace the `DOWNLOAD_URL` line and the comment above it with:

```ts
export const RELEASE: Release | null = __KELP_RELEASE__;

export const DOWNLOAD_URL = "https://dl.kelp.ozanai.dev/Kelp_aarch64.dmg";
```

and add `import type { Release } from "./release";` at the top.

`website/src/components/DownloadButton.tsx`: import `RELEASE` instead of `SITE`, and change `if (!SITE.released) {` to `if (!RELEASE) {`.

`website/src/head.ts`: import `RELEASE` from `./config` too, and replace `softwareVersion: SITE.version,` with `...(RELEASE ? { softwareVersion: RELEASE.version } : {}),`.

`website/src/pages/Landing.tsx`: import `RELEASE`, and replace the `Version {SITE.version} for Apple Silicon, {SITE.minMacOS} or later.` text with:

```tsx
              {RELEASE ? `Version ${RELEASE.version} for Apple Silicon, ${SITE.minMacOS} or later.` : `For Apple Silicon, ${SITE.minMacOS} or later.`}
```

- [ ] **Step 4: Run tests and build**

Run: `cd website && npm test && npm run build && grep -l "Download coming soon" dist/index.html`
Expected: tests pass; the build passes (no release exists yet, so the fetch fails and the page says "Download coming soon"); grep prints `dist/index.html`. Then `grep -c "softwareVersion" dist/index.html` prints `0`.

- [ ] **Step 5: Commit**

```bash
git add website/src/release.ts website/tests/release.test.ts website/src/vite-env.d.ts website/vite.config.ts website/src/config.ts website/src/head.ts website/src/components/DownloadButton.tsx website/src/pages/Landing.tsx website/package.json
git commit -m "Take the site's version and download button from the live release"
```

---

### Task 7: Publish and website workflows

**Files:**
- Create: `.github/workflows/publish.yml`, `.github/workflows/website.yml`

**Interfaces:**
- Consumes: `releases/<version>/` from Task 2; the site build from Task 6.
- Produces: "Publish release" (manual, input `version`) and "Deploy website" (push, manual, or called by Publish).

- [ ] **Step 1: Write the website workflow**

`.github/workflows/website.yml`:

```yaml
name: Deploy website

on:
  push:
    branches: [master]
    paths:
      - "website/**"
      - "design/**"
  workflow_dispatch:
  workflow_call:
    secrets:
      CLOUDFLARE_API_TOKEN:
        required: true
      CLOUDFLARE_ACCOUNT_ID:
        required: true

concurrency:
  group: website
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: website
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: website/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
      - name: Deploy to Cloudflare Pages
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx --yes wrangler@4 pages deploy dist --project-name kelp --branch master
```

- [ ] **Step 2: Write the publish workflow**

`.github/workflows/publish.yml`:

```yaml
name: Publish release

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version to publish, for example 0.2.0"
        required: true

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      VERSION: ${{ inputs.version }}
      R2_ENDPOINT: https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      AWS_DEFAULT_REGION: auto
      AWS_REQUEST_CHECKSUM_CALCULATION: when_required
      AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
    steps:
      - name: Check the version and its build
        run: |
          if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "\"$VERSION\" isn't a version like 0.2.0."
            exit 1
          fi
          for file in "Kelp_${VERSION}_aarch64.dmg" Kelp.app.tar.gz Kelp.app.tar.gz.sig latest.json; do
            if ! aws s3 ls "s3://kelp-downloads/releases/$VERSION/$file" --endpoint-url "$R2_ENDPOINT" > /dev/null; then
              echo "releases/$VERSION/$file is missing. Push the v$VERSION tag and wait for its build first."
              exit 1
            fi
          done

      - name: Make the download live
        run: |
          aws s3 cp "s3://kelp-downloads/releases/$VERSION/Kelp_${VERSION}_aarch64.dmg" s3://kelp-downloads/Kelp_aarch64.dmg \
            --endpoint-url "$R2_ENDPOINT" --metadata-directive REPLACE --cache-control no-cache --content-type application/x-apple-diskimage

      - name: Make the update live
        run: |
          aws s3 cp "s3://kelp-downloads/releases/$VERSION/latest.json" s3://kelp-downloads/latest.json \
            --endpoint-url "$R2_ENDPOINT" --metadata-directive REPLACE --cache-control no-cache --content-type application/json

  website:
    needs: publish
    uses: ./.github/workflows/website.yml
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3: Lint and dry-run the validation**

Run: `npx --yes actionlint@1 .github/workflows/publish.yml .github/workflows/website.yml` (or the PyYAML fallback from Task 2).
Then dry-run the version check from the publish workflow in a shell:

```bash
for VERSION in 0.2.0 '0.2.0; rm -rf ~' v0.2.0 ''; do
  if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "reject: [$VERSION]"; else echo "accept: [$VERSION]"; fi
done
```

Expected: only `accept: [0.2.0]`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml .github/workflows/website.yml
git commit -m "Publish a built release to R2 and redeploy the website"
```

---

### Task 8: Docs

**Files:**
- Modify: `README.md`, `SPEC.md`, `CLAUDE.md`, `docs/STATUS.md`

- [ ] **Step 1: README "Releasing"** — replace the whole section with:

```markdown
## Releasing

1. Bump `version` in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml`.
2. Tag with release notes and push: `git tag -a v0.2.0 -m "What changed" && git push origin v0.2.0`.
3. The Release workflow builds, signs, notarises and uploads to `releases/0.2.0/` on `dl.kelp.ozanai.dev`.
   Nobody sees it yet. Download the `.dmg` from there (or the draft GitHub release) and try it.
4. Actions → Publish release → Run workflow → `0.2.0`. That updates `latest.json`, `Kelp_aarch64.dmg` and the
   website. To roll back, publish the older version.

One-time setup (Cloudflare, Apple, the updater key and the GitHub secrets) is in section 8 of
`docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`.
```

- [ ] **Step 2: SPEC.md**

- §4 M5: append "· built (see `docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`); done when v0.1.0 is published and v0.1.1 updates it."
- §9: replace "Publish `Kelp_<version>_aarch64.dmg` to GitHub Releases." with "Upload builds to Cloudflare R2 (`dl.kelp.ozanai.dev`); a Publish workflow makes one live."
- §9.1 "Endpoint" bullet: replace with "`https://dl.kelp.ozanai.dev/latest.json`, written only by the Publish workflow."
- §10: replace the hosting bullet with "Cloudflare Pages project `kelp`, deployed by `.github/workflows/website.yml`. The version and download button come from the live `latest.json` at build time."

- [ ] **Step 3: CLAUDE.md**

- Replace "- `SITE.released` must stay `false` until a `.dmg` is attached to a GitHub Release." with "- The site's version and download button come from the live `https://dl.kelp.ozanai.dev/latest.json` at build time. Never hard-code them."
- Replace "- Releases are cut by pushing a `v*` tag, which triggers `.github/workflows/release.yml`." with "- Pushing a `v*` tag builds a release onto R2 without publishing it; the \"Publish release\" workflow makes it live."

- [ ] **Step 4: docs/STATUS.md**

Add a section after the M5 part 1 section:

```markdown
## M5 part 2: signed releases, auto-update, website — built

Spec: `docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`. Needs the one-time setup in its section 8.

### First release, by hand

- [ ] Tag `v0.1.0`: the build passes, `releases/0.1.0/` has four files, a draft release exists.
- [ ] The `.dmg` opens on a Mac that has never run Kelp, with no warning (`spctl -a -vv Kelp.app` says "Notarized Developer ID").
- [ ] Publish `0.1.0`: `latest.json` and `Kelp_aarch64.dmg` are live; the site shows "Version 0.1.0" and a working button.
- [ ] Install 0.1.0, then tag and publish `0.1.1`: 0.1.0 shows the banner, restarts into 0.1.1, keeps its connections.
- [ ] With a transfer running, Restart asks first.
```

and in the "M5: release" section, remove the bullets now covered (signing in `release.yml`, the updater, the landing site).

- [ ] **Step 5: Commit**

```bash
git add README.md SPEC.md CLAUDE.md docs/STATUS.md
git commit -m "Document releasing through R2 and the Publish workflow"
```
