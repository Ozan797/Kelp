# Kelp

A fast Mac app for browsing and transferring files across Amazon S3, Cloudflare R2 and Hetzner Object Storage.

- **Platform:** macOS, Apple Silicon
- **Stack:** Rust, Tauri 2, React, TypeScript, Vite
- **Docs:** see [`SPEC.md`](SPEC.md) for the full plan and [`CLAUDE.md`](CLAUDE.md) for contributor and AI guidance

## Prerequisites

- macOS on Apple Silicon
- [Rust](https://rustup.rs) 1.85 or newer
- Node.js 20 or newer
- Xcode Command Line Tools: `xcode-select --install`

## Getting started

The app lives at the repo root (`src/` for the React UI, `src-tauri/` for the Rust core):

```bash
rustup update stable   # Rust 1.85 or newer (the app uses Rust edition 2024)
npm install
npm run tauri dev      # opens the Kelp window with hot reload
```

The landing site is already set up:

```bash
cd website
npm install
npm run dev
```

## Landing site

Lives in `website/`. Edit names, version and the download link in `website/src/config.ts`.
Build with `npm run build` (it type-checks, prerenders every page and checks the output) and run `npm test` for the theme, path and contrast checks. Deploy to Cloudflare Pages (build command `npm run build`, root `website`, output `dist`) on a subdomain such as `kelp.ozanai.dev`.

## Releasing

1. Bump the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Push a tag: `git tag v0.1.0 && git push --tags`.
3. GitHub Actions builds the `.dmg` and creates a draft release. Publish it.
4. Set `released: true` in `website/src/config.ts` and redeploy the site.

For a `.dmg` that opens without Gatekeeper warnings, add the Apple signing secrets listed in `.github/workflows/release.yml`.
