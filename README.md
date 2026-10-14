# Bucket Browser

A fast Mac app for browsing and transferring files across Amazon S3, Cloudflare R2 and Hetzner Object Storage.

- **Platform:** macOS, Apple Silicon
- **Stack:** Rust, Tauri 2, React, TypeScript, Vite
- **Docs:** see [`SPEC.md`](SPEC.md) for the full plan and [`CLAUDE.md`](CLAUDE.md) for contributor and AI guidance

## Prerequisites

- macOS on Apple Silicon
- [Rust](https://rustup.rs) (stable)
- Node.js 20 or newer
- Xcode Command Line Tools: `xcode-select --install`

## Getting started

The app itself is created with the Tauri generator (it adds `src/` and `src-tauri/` at the repo root):

```bash
npm create tauri-app@latest   # choose TypeScript + React; use this folder
npm install
npm run tauri dev
```

The landing site is already set up:

```bash
cd website
npm install
npm run dev
```

## Landing site

Lives in `website/`. Edit names, version and the download link in `website/src/config.ts`.
Build with `npm run build` and deploy the `dist/` folder to Cloudflare Pages or Netlify, then point a subdomain such as `bucket.ozanai.dev` at it with a CNAME record.

## Releasing

1. Bump the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Push a tag: `git tag v0.1.0 && git push --tags`.
3. GitHub Actions builds the `.dmg` and creates a draft release. Publish it.
4. Set `released: true` in `website/src/config.ts` and redeploy the site.

For a `.dmg` that opens without Gatekeeper warnings, add the Apple signing secrets listed in `.github/workflows/release.yml`.
