# Kelp M5, part 2: signed releases, auto-update and the website

Date: 2026-10-16
Status: approved in conversation (decisions below); written spec

## 1. Purpose

Finish M5 (SPEC §4, §9, §10): a pushed `v*` tag produces a signed, notarised Kelp that nobody sees yet; one
"Publish release" button makes it live for new downloads, for installed copies through the auto-updater, and on
the website at `kelp.ozanai.dev`. Nothing personal (Team ID, Apple ID, keys) is in the repo; it all lives in
GitHub secrets.

Builds on part 1 (`2026-10-16-kelp-keychain-touch-id-design.md`): the entitlements template, `KELP_TEAM_ID`,
`APPLE_SIGNING_IDENTITY` and the gitignored provisioning profile.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Where downloads live | Cloudflare R2 bucket `kelp-downloads` on `https://dl.kelp.ozanai.dev`. Works while the repo is private |
| Going live | Tag builds and uploads to `releases/<version>/`; a manual "Publish release" workflow makes it live |
| Notarisation sign-in | App Store Connect API key (key file, key ID, issuer ID) |
| Build command | `npm run tauri build` in CI, the same as locally; no `tauri-action` |
| Updater | `tauri-plugin-updater` + `tauri-plugin-process`, driven from the UI through `lib/tauri.ts` |
| Release notes | The annotated tag's message (`git tag -a v0.2.0 -m "…"`) |
| Website hosting | Cloudflare Pages project `kelp`, deployed by a GitHub workflow with `wrangler` |
| Site version and download | Read from the live `latest.json` at build time; no hand edits to `SITE.version` / `SITE.released` |
| Not in scope | Making the repo public, analytics, Intel builds, any host other than R2 |
| Code comments | None (CLAUDE.md) |

## 3. Files on R2

```
dl.kelp.ozanai.dev/
├── latest.json                      live update manifest (written only by Publish)
├── Kelp_aarch64.dmg                 newest published .dmg (written only by Publish)
└── releases/<version>/              written by the tag build, never changed after
    ├── Kelp_<version>_aarch64.dmg
    ├── Kelp.app.tar.gz
    ├── Kelp.app.tar.gz.sig
    └── latest.json                  the manifest this version will publish
```

`releases/<version>/latest.json`, following Tauri's static manifest format:

```json
{
  "version": "0.2.0",
  "notes": "<annotated tag message>",
  "pub_date": "2026-10-20T10:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of Kelp.app.tar.gz.sig>",
      "url": "https://dl.kelp.ozanai.dev/releases/0.2.0/Kelp.app.tar.gz"
    }
  }
}
```

## 4. Building a release (`.github/workflows/release.yml`, on `v*` tags)

Runner: `macos-latest` (Apple Silicon). Steps:

1. **Version check.** The tag without `v` must equal `version` in `app/src-tauri/tauri.conf.json`,
   `app/src-tauri/Cargo.toml` and `app/package.json`. Otherwise fail: "Tag v0.2.0 doesn't match the app version
   0.1.9. Bump all three files, then tag again."
2. **Refuse to overwrite.** If `releases/<version>/` already holds files on R2, fail: "0.2.0 is already built. Bump
   the version for a new build." Published builds never change.
3. **Signing inputs from secrets.** Write `app/src-tauri/Kelp.provisionprofile` and the App Store Connect key file
   (to `$RUNNER_TEMP`) from base64 secrets. Tauri imports `APPLE_CERTIFICATE` into a temporary keychain itself.
4. **Build.** `npm ci` then `npm run tauri build -- --target aarch64-apple-darwin` in `app/`, with `KELP_TEAM_ID`,
   `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY`,
   `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   `bundle.createUpdaterArtifacts: true` makes Tauri sign, notarise, staple, and produce `Kelp.app.tar.gz` + `.sig`.
5. **Manifest.** `app/scripts/manifest.mjs <version> <sig file> <notes file>` prints the §3 `latest.json`.
6. **Upload** to `s3://kelp-downloads/releases/<version>/` with the preinstalled `aws` CLI
   (`--endpoint-url https://<account id>.r2.cloudflarestorage.com`, R2 access key from secrets).
7. **Record.** A draft GitHub Release `v<version>` with the same four files.

The runner's temporary files (key file, profile, keychain) are deleted in an `always()` step.

## 5. The updater in the app

### 5.1 Setup

- Rust: register `tauri_plugin_updater` and `tauri_plugin_process` in `lib.rs`.
- `tauri.conf.json`: `bundle.createUpdaterArtifacts: true`; `plugins.updater.endpoints:
  ["https://dl.kelp.ozanai.dev/latest.json"]`; `plugins.updater.pubkey: "<public key>"` (public, committed).
- Capabilities: add only `updater:default` and `process:allow-restart`.
- `opener:allow-open-url` is unchanged; no new URLs open from the app.
- Menu: "Check for updates…" in the Kelp menu emits `menu://check-updates` to the window.

### 5.2 Behaviour

| When | What happens |
|---|---|
| Launch, then every 6 hours | Check silently. Found → download in the background → show the banner. Nothing new or offline → nothing |
| "Check for updates…" (menu or ⌘K) | Same, but always answers: the banner, "Kelp is up to date (0.2.0).", or "Kelp couldn't check for updates. Check your internet connection and try again." |
| Banner | Bottom of the window, non-blocking: "Kelp 0.2.0 is ready. Restart to update" · "Release notes" (expands the notes) · "Later" (hides it until next launch) · "Restart" |
| Restart with transfers running | Confirm: "3 transfers are running. Restart now? They'll resume after Kelp reopens." · "Restart" / "Not now" |
| Dev builds | Never check (`import.meta.env.DEV`); the menu item says "Updates are off in development builds." |

A check already running makes another request wait for it rather than start a second one. A download that fails
shows nothing on a silent check, and the error message above on a manual one.

### 5.3 Structure

- `app/src/lib/tauri.ts`: typed wrappers `checkForUpdate()`, `installUpdate(update)`, `restartApp()`,
  `onCheckForUpdates(handler)`; components never import the plugins directly.
- `app/src/hooks/useUpdater.ts`: the state machine (idle → checking → downloading → ready, or up to date / failed),
  timers, the single in-flight check.
- `app/src/components/UpdateBanner.tsx`: the banner and the restart confirmation.
- `App.tsx`: mounts the banner, adds the ⌘K action, passes the running-transfer count.

## 6. Publishing (`.github/workflows/publish.yml`, `workflow_dispatch`)

Input: `version` (e.g. `0.2.0`). Steps, in this order:

1. Check all four files exist under `releases/<version>/`; otherwise fail and change nothing.
2. Copy `releases/<version>/Kelp_<version>_aarch64.dmg` → `Kelp_aarch64.dmg`.
3. Copy `releases/<version>/latest.json` → `latest.json` with `Cache-Control: no-cache`.
4. Run the website deploy (§7) so the site shows the new version.

The `.dmg` goes first so that anyone the update reaches can also download the same version from the site. Publishing an older
version is allowed and is the rollback: installed copies only move forward (the updater ignores older versions),
new downloads get the older `.dmg`.

## 7. The website

### 7.1 Live release at build time

- `website/src/release.ts`: `parseRelease(json: unknown): { version: string } | null` (pure, tested) and
  `fetchRelease()` that reads `https://dl.kelp.ozanai.dev/latest.json` with a 5 s timeout; any failure is `null`.
- `vite.config.ts` awaits `fetchRelease()` and defines it for the build. `KELP_RELEASE=none` skips the fetch
  (offline work and tests).
- `config.ts`: `SITE.version` and `SITE.released` are removed; `RELEASE` (the fetched value or `null`) replaces
  them. `DOWNLOAD_URL` becomes `https://dl.kelp.ozanai.dev/Kelp_aarch64.dmg`.
- `DownloadButton`, `Landing` and `head.ts` read `RELEASE`: `null` → "Download coming soon" and no
  `softwareVersion`; a release → the button and "Version 0.2.0 for Apple Silicon".

### 7.2 Deploying (`.github/workflows/website.yml`)

Runs on pushes to `master` touching `website/**` or `design/**`, and when called by Publish. Steps: `npm ci`,
`npm test`, `npm run build`, `npx wrangler pages deploy website/dist --project-name kelp --branch master`, with
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## 8. One-time setup (the developer)

**Cloudflare** (dash.cloudflare.com):
1. R2 → Create bucket `kelp-downloads` → Settings → Custom Domains → Connect `dl.kelp.ozanai.dev`.
2. R2 → Manage API tokens → Create token, "Object Read & Write" on `kelp-downloads` → note the access key ID and
   secret.
3. Workers & Pages → Create → Pages → Direct Upload → project name `kelp` → Custom domains → `kelp.ozanai.dev`.
4. My Profile → API Tokens → Create token with "Cloudflare Pages: Edit" → note it, and the account ID.

**Apple:**
1. Keychain Access → "Developer ID Application: …" certificate → Export as `.p12` with a password.
2. appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API → Team Keys → generate a
   key with "Developer" access → download the `.p8` (only once) → note the key ID and issuer ID.

**Updater key:** `cd app && npm run tauri signer generate -- -w ~/.tauri/kelp.key` → save the private key and its
password in a password manager **and** as GitHub secrets. Losing it means installed copies can never update again.

**GitHub secrets** (repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | its password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <name> (<Team ID>)` |
| `KELP_TEAM_ID` | Team ID |
| `KELP_PROVISION_PROFILE` | base64 of `Kelp.provisionprofile` |
| `APPLE_API_KEY` | key ID |
| `APPLE_API_ISSUER` | issuer ID |
| `APPLE_API_KEY_P8` | base64 of the `.p8` |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/kelp.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from Cloudflare step 2 |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | from Cloudflare step 4 |

## 9. Testing

Automated:
- `app/scripts/manifest.test.mjs`: builds the §3 JSON from a signature and notes; rejects a bad version or an
  empty signature.
- `app/scripts/version.test.mjs` (the tag check): matching versions pass; any mismatch names the files.
- `useUpdater` tests with a fake updater: found → ready; up to date and offline are silent on a timed check and
  answered on a manual one; one check at a time; Later hides until next launch.
- `UpdateBanner` tests: the copy, Release notes toggle, restart confirmation only when transfers run.
- `website/tests/release.test.ts`: `parseRelease` on a valid manifest, missing version, wrong types, and `null`.

By hand (the first release):
- [ ] Tag `v0.1.0` → the build passes, files appear under `releases/0.1.0/`, a draft release exists.
- [ ] The `.dmg` from R2 opens on a Mac that has never seen Kelp, with no "unidentified developer" warning
      (`spctl -a -vv Kelp.app` says "Notarized Developer ID").
- [ ] Publish `0.1.0` → `dl.kelp.ozanai.dev/latest.json` and `Kelp_aarch64.dmg` are live; the site shows
      "Version 0.1.0" and a working Download button.
- [ ] Install 0.1.0, then build and publish `0.1.1` → 0.1.0 shows the banner, restarts into 0.1.1, and keeps its
      connections (same Keychain item, same signature).
- [ ] With a transfer running, Restart asks first.

## 10. Docs to update

- `SPEC.md` §4 (M5 done when the first release is live), §9 and §9.1 (R2, Publish), §10 (Pages via workflow),
  §12 question 2 if the name and subdomain are now final.
- `README.md` "Releasing": tag → test → Publish, and the one-time setup in §8.
- `CLAUDE.md`: replace "`SITE.released` must stay `false` until…" with "The site's version and download button come
  from the live `latest.json`; never hard-code them." Releases: "Pushing a `v*` tag builds; the Publish workflow
  makes it live."
- `docs/STATUS.md`: M5 status and the first-release checklist.
