# Kelp

A fast Mac app for browsing and transferring files across Amazon S3, Cloudflare R2 and Hetzner Object Storage.

- **Platform:** macOS, Apple Silicon
- **Stack:** Rust, Tauri 2, React, TypeScript, Vite
- **Docs:** see [`SPEC.md`](SPEC.md) for the full plan and [`CLAUDE.md`](CLAUDE.md) for contributor and AI guidance

## Prerequisites

- macOS on Apple Silicon
- [Rust](https://rustup.rs) 1.90 or newer
- Node.js 20 or newer
- Xcode Command Line Tools: `xcode-select --install`

## Getting started

The app lives in `app/` (`src/` for the React UI, `src-tauri/` for the Rust core):

```bash
rustup update stable   # Rust 1.90 or newer (needed by Tauri 2.12)
cd app
npm install
npm run tauri dev      # opens the Kelp window with hot reload
```

The landing site is already set up:

```bash
cd website
npm install
npm run dev
```

## Signing

Dev builds (`npm run tauri dev`) are signed with your "Apple Development" certificate if you have one, so the
Keychain's "Always Allow" sticks across rebuilds. Pick a certificate with `KELP_DEV_SIGNING_IDENTITY`. Without
one, dev builds run unsigned and ask for your password each launch. The first signed dev build or `cargo test`
may show a one-time macOS prompt asking to let `codesign` use your key; click Always Allow.

Release builds keep secrets in one Keychain item unlocked with Touch ID. They need, once:

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → + → App IDs → App. Bundle ID
   `dev.ozanai.kelp` (explicit), description "Kelp", no extra capabilities.
2. Profiles → + → Developer ID → that App ID → your Developer ID Application certificate → Generate → Download.
3. Save it as `app/src-tauri/Kelp.provisionprofile` (gitignored).

Then:

    export KELP_TEAM_ID=<your Team ID>
    export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<Team ID>)"
    cd app && npm run tauri build

After a release build has moved your secrets into the new item, `tauri dev` on the same Mac asks for the secret
keys again: they're no longer in the old Keychain item it reads.

## Keyboard shortcuts

| Keys | Does |
|---|---|
| ⌘K | Command palette (places and actions) |
| Space | Preview the selected file |
| ⌘D | Download the selection |
| ⌘⇧N | New folder |
| ⌘T / ⌘W | New tab / close tab |
| ⌘⇧] / ⌘⇧[ | Next / previous tab |
| ⌘, | Settings |
| ⌫ or ⌘↑ | Up one folder |
| ⌥ while dropping rows | Copy instead of move |

## Landing site

Lives in `website/`. Names and URLs live in `website/src/config.ts`. The version and download button come from the live `latest.json` at build time.
Build with `npm run build` (it type-checks, prerenders every page and checks the output) and run `npm test` for the theme, path and contrast checks. `.github/workflows/website.yml` deploys the site on pushes to `master` that touch `website/` or `design/`, and after each Publish (one-time Pages setup is in section 8 of `docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`).

## Releasing

1. Bump `version` in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml`.
2. Tag with release notes and push: `git tag -a v0.2.0 -m "What changed" && git push origin v0.2.0`.
3. The Release workflow builds, signs, notarises and uploads to `releases/0.2.0/` on `kelp-dl.ozanai.dev`.
   Nobody sees it yet. Download the `.dmg` from there (or the draft GitHub release) and try it.
   If the build fails after uploading, bump the patch version and tag again; a built version is never replaced.
4. Actions → Publish release → Run workflow → `0.2.0`. That updates `latest.json`, `Kelp_aarch64.dmg` and the
   website. To roll back, publish the older version.

One-time setup (Cloudflare, Apple, the updater key and the GitHub secrets) is in section 8 of
`docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`.
