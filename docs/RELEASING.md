# Releasing Kelp

How a new version gets from `master` to people's Macs. Design and reasons: `docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| `.github/workflows/release.yml` | runs on a pushed `v*` tag | Builds, signs, notarises and uploads to R2 under `releases/<version>/`. Nobody sees it yet. Also drafts a GitHub release. |
| `.github/workflows/publish.yml` | Actions → **Publish release**, input `version` | Makes a built version live: copies its `latest.json` and `.dmg` to the bucket root, then redeploys the website. |
| `.github/workflows/website.yml` | pushes to `master` touching `website/` or `design/`, manual runs, and Publish | Reads the live release through R2's API, builds the site, deploys it to Netlify. |
| Downloads and updates | Cloudflare R2 bucket `kelp-downloads` at `https://kelp-dl.ozanai.dev` | `latest.json` (update manifest), `Kelp_aarch64.dmg`, and `releases/<version>/…` |
| Website | Netlify, `https://kelp.ozanai.dev` (CNAME in Cloudflare DNS, DNS only) | Shows the live version and links to that version's `.dmg`. |
| In the app | `tauri-plugin-updater` | Checks `https://kelp-dl.ozanai.dev/latest.json` on launch, every 6 hours, and from **Kelp → Check for updates…** / ⌘K. |

`https://kelp-dl.ozanai.dev/latest.json` is compiled into every installed copy. Never change that address.

## Cut a release

1. **Write the release notes** on a branch from `master`. Read what changed with `git log --oneline v<last>..master` and the merged PRs, then add the entry at the top of `website/src/notes.ts`:
   - `version` and `date` (today, `YYYY-MM-DD`).
   - `summary`: one plain sentence. The app's update card and `latest.json` show it.
   - `changes`: 2–5 items, each a `title` and a one-sentence `body`. Sentence case, plain words.
   - `scene`: only when the main change is visual. Add a component in `website/src/components/` that uses fake data from `website/src/data.ts` only, register it in `SCENES` in `website/src/pages/WhatsNew.tsx`, and set `scene` to its key.
   - Show the entry to the developer and wait for approval.
2. **Bump the version** in all five places, in the same branch as the notes:
   - `app/package.json` and `app/src-tauri/tauri.conf.json`: `"version": "0.2.0"`
   - `app/src-tauri/Cargo.toml`: the `version` line in `[package]` only (not a dependency's). macOS `sed` has no `0,/re/` form; edit it by hand or with a small script.
   - Refresh the lock files: `cd app && npm install --package-lock-only`, then `cd src-tauri && cargo check`.
   - Check: `node app/scripts/version.mjs 0.2.0` prints nothing and exits 0. It's the same check the release workflow runs.
   - Commit as `Release 0.2.0`, push, open a PR, merge it.
3. **Tag `master`.** The release notes come from `website/src/notes.ts` at the tagged commit, not from the tag message, so the message only names the version:
   ```
   git checkout master && git pull
   git tag -a v0.2.0 -m "Kelp 0.2.0"
   git push origin v0.2.0
   ```
4. **Wait for Actions → Release** (about 15–20 minutes, mostly notarisation). It stops before uploading anything if:
   - the tag doesn't match the three version files,
   - `website/src/notes.ts` has no entry for this version,
   - `releases/0.2.0/` already exists on R2 (built versions are never replaced: bump to 0.2.1 instead),
   - the updater signing key in GitHub doesn't match the public key in `tauri.conf.json`.
5. **Try the build before anyone else sees it.** Download in Safari (so it's marked as downloaded):
   `https://kelp-dl.ozanai.dev/releases/0.2.0/Kelp_0.2.0_aarch64.dmg`. Open it, install, run. The only prompt should be "downloaded from the internet, open it?". Optional: `spctl -a -vv /Applications/Kelp.app` says "Notarized Developer ID".
6. **Publish:** Actions → **Publish release** → Run workflow → `0.2.0`
   (or `gh workflow run publish.yml -R Ozan797/Kelp -f version=0.2.0`). About 2 minutes. Afterwards:
   - `https://kelp-dl.ozanai.dev/latest.json` says `"version": "0.2.0"`,
   - `https://kelp.ozanai.dev` shows "Version 0.2.0" and its Download button links to `releases/0.2.0/…`,
   - installed copies offer the update on their next check.
7. **Check an installed older copy updates:** open it → **Kelp → Check for updates…** → the **Update ready** indicator at the right end of the status bar → its card: **What's new** opens the notes on the website, **Restart to update** → **Kelp → About Kelp** shows the new version, connections still open.

## Roll back

Publish the older version: Actions → **Publish release** → `0.1.1`. New downloads and the website go back to it. Installed copies that already updated stay on the newer one (the updater never offers an older version), so fix forward with a new patch release.

## When something fails

| Symptom | Cause and fix |
|---|---|
| Release: "No release notes for 0.2.0. Add an entry to website/src/notes.ts before tagging." | The tag has no entry in `website/src/notes.ts`. Add the entry on `master` (step 1), merge, then delete the tag (`git push --delete origin v0.2.0 && git tag -d v0.2.0`), tag again and push. Nothing was uploaded. |
| Release: "Tag v… doesn't match the app version in …" | A version file wasn't bumped. Fix it on `master`, delete the tag (`git push --delete origin v0.2.0 && git tag -d v0.2.0`), tag again. Nothing was uploaded. |
| Release: "… is already built" | That version exists on R2. Bump the patch version and tag again. |
| Release: "The update was signed with key … but the app trusts key …" | `TAURI_SIGNING_PRIVATE_KEY` in GitHub isn't the key matching `plugins.updater.pubkey`. Re-add the right one from the password manager. |
| Release fails after "Upload to R2" | Bump the patch version and tag again; the half-built version stays unused. |
| Website deploy: "The site built without a release" | The build couldn't read `latest.json`. Look at the "Read the live release from R2" step, then re-run Actions → **Deploy website**. |
| `npm test` on CI: `bad option: --experimental-strip-types` | A workflow set up Node older than 22. Every workflow uses Node 22. |
| Public `kelp-dl.ozanai.dev` returns 403 to scripts or servers | Cloudflare Bot Fight Mode on `ozanai.dev`. It stays on (other projects need it), so CI reads R2 through its API instead. Some VPN users may not get update checks; they can download from the site. |

## One-time setup (already done)

Listed so it can be repeated on a new account or machine. Full click-by-click steps: section 8 of the M5 release spec.

- Cloudflare R2 bucket `kelp-downloads` with custom domain `kelp-dl.ozanai.dev`, and an R2 API token (Object Read & Write on that bucket).
- Netlify site `kelp-ozanai` with domain `kelp.ozanai.dev`; Cloudflare DNS `CNAME kelp → kelp-ozanai.netlify.app`, DNS only.
- Apple: Developer ID Application certificate (exported as `.p12`), App ID `dev.ozanai.kelp`, a Developer ID provisioning profile (local copy at the gitignored `app/src-tauri/Kelp.provisionprofile`), an App Store Connect API key.
- Updater key: `~/.tauri/kelp.key` and its password, backed up in the password manager. Losing it means installed copies can never update again.
- GitHub repository secrets (15): `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `KELP_TEAM_ID`, `KELP_PROVISION_PROFILE`, `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`.

## Building a signed copy locally

Needs the provisioning profile file and the signing certificate in your Keychain. Identity details stay in your shell, never in the repo:

```
cd app && KELP_TEAM_ID=<Team ID> APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<Team ID>)" npm run tauri build
```

The `.dmg` step may fail locally until the terminal is allowed to control Finder (System Settings → Privacy & Security → Automation); `Kelp.app` is still built and signed.
