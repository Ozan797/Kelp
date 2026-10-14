# CLAUDE.md

Guidance for Claude when working in this repository. Read `SPEC.md` first; it is the source of truth for scope and design.

## What this is

A Mac-only (Apple Silicon) desktop app for browsing and transferring files across Amazon S3, Cloudflare R2 and Hetzner Object Storage. Rust core, Tauri 2 shell, React + TypeScript UI. A separate landing site lives in `website/`.

## About the developer

Junior frontend developer who knows TypeScript, React, Vite, Python and some backend work, and is **new to Rust**. They like learning.
- When you introduce a Rust concept (ownership, lifetimes, `async`, traits, `Arc`/`Mutex`), explain it in one or two plain sentences the first time it matters.
- Prefer clear code over clever code. Say why, not just what.
- Suggest next steps in small pieces, and do not rewrite large areas unasked.

## Commands

```bash
npm install                 # root deps (app UI + Tauri CLI)
npm run tauri dev           # run the app with hot reload
npm run tauri build         # build the .dmg locally
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt   --manifest-path src-tauri/Cargo.toml

cd website && npm install && npm run dev      # landing site
cd website && npm run build                   # type-check + production build
cd website && npm test                        # theme, path and contrast checks
python3 -m http.server 8000 -d design         # then open http://localhost:8000/reference/
```

## Architecture rules

- UI → `src-tauri/src/commands/` → `providers/` and `transfers/`. The UI never talks to storage directly.
- `providers/` is the only place that knows about S3. Everything else uses the `StorageProvider` trait.
- S3, R2 and Hetzner share one implementation (`providers/s3.rs`). Differences are data in `ConnectionProfile`, not new code paths.
- One app error type in `error.rs`. Commands return `Result<T, AppError>` and errors must serialise to a message the UI can show.
- Slow work is `async` on tokio. Never block the main thread or hold a lock across an `.await` unless it is a `tokio::sync` lock.
- Typed wrappers for every command live in `src/lib/tauri.ts`. Do not call `invoke()` from components.

## Security rules (do not break)

- Secret access keys live **only** in the macOS Keychain via `keyring`. Never in JSON files, logs, error messages, test fixtures or commit history.
- Never log presigned URLs, signatures or secrets.
- Keep Tauri capabilities minimal. Do not add shell access or broad filesystem scope.
- Deleting or overwriting objects needs an explicit confirmation in the UI.

## Code style

**Rust**
- `cargo fmt` and `cargo clippy -D warnings` must pass.
- Avoid `unwrap()` and `expect()` outside tests; propagate errors with `?`.
- Small modules, doc comments on public items, tests next to the code.

**TypeScript / React**
- Strict TypeScript, no `any`. Function components and hooks.
- File lists must be virtualised. Do not render thousands of rows directly.
- Plain CSS with variables. Use the semantic tokens in `design/tokens.css` only (no raw hex or scale values outside that file). Shared components live in `design/components.css`; the reference sheet is `design/reference/index.html`.
- Respect `prefers-reduced-motion` and keep visible focus states.

## UI copy

Sentence case, active voice, plain words. Buttons say exactly what they do ("Delete 3 files", not "OK"). Errors explain what happened and what to try, and never apologise.

## Website (`website/`)

- Separate Vite + React + TS project; deployed as static files to a subdomain of `ozanai.dev`.
- All names, versions and URLs live in `website/src/config.ts`. Change them there only.
- Pages are prerendered. A new page needs a `PAGES` entry in `config.ts` and a `ROUTES` entry in `routes.tsx`.
- `SITE.released` must stay `false` until a `.dmg` is attached to a GitHub Release.
- The hero demo (`components/DemoWindow.tsx`) uses fake data in `src/data.ts`. It must never contain real bucket names or keys.

## Git

- Small, focused commits with clear messages.
- Never commit `.env` files, keys, `dist/`, `target/` or `node_modules/`.
- Releases are cut by pushing a `v*` tag, which triggers `.github/workflows/release.yml`.

## When unsure

Check `SPEC.md` section 12 (Open questions) before assuming. If a decision is not covered, ask rather than guess.
