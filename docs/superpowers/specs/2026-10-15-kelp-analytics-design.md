# Kelp analytics, error reports and usage stats

Date: 2026-10-15
Status: **draft for review**. Planned after M4; decisions in §6 are open

## 1. Purpose

Know how the website is doing (visits, where people come from, downloads), learn about crashes and errors in the
app before users report them, and see which features people use, without collecting anything that identifies a
person or reveals what they store.

## 2. Ground rules (apply to every part)

- **Never collected:** bucket names, object keys, file or folder names, local paths, endpoints, account IDs,
  access keys, secrets, presigned URLs, IP addresses (beyond what a provider sees for delivery), exact sizes.
- **In the app, everything is opt-in.** Settings gets two switches, both off until turned on:
  `Share anonymous usage statistics` and `Send crash and error reports`. First launch shows one short note with
  both switches and `Not now` (the default).
- Sizes and counts are sent only as buckets: `<10 MB`, `<1 GB`, `<10 GB`, `10 GB+`; `1`, `2–10`, `11–100`, `100+`.
- Errors are sent by `AppError` kind (`network`, `accessDenied`, …), never by message, since messages can contain
  bucket names.
- The website and the app say what is collected on a privacy page (`/privacy/`), linked from Settings.
- CLAUDE.md security rules stand; anything that could carry a secret is dropped before sending.

## 3. Website

- **Recommended: Cloudflare Web Analytics.** It's free, uses no cookies, and the site is already planned for
  Cloudflare Pages. It shows page views, visitors (counted without identifying anyone), referrers, countries,
  devices and Core Web Vitals.
- Downloads are counted from GitHub Releases' own download counts (public API), shown in a small script or read by
  hand; no tracking on the button.
- "Who visited" means aggregate numbers (how many, from where, which pages), not individual people.
- Alternative if custom events are wanted (for example "clicked Download"): **Plausible** (paid, cookieless, EU).
- Setup: the beacon token goes in `website/src/config.ts`; the prerender adds the script tag; CSP for the site
  allows the beacon host.

## 4. App: crash and error reports

- **Recommended: Sentry** (free tier), Rust side with the `sentry` crate (panics and `AppError`s from commands) and
  the UI side with `@sentry/browser` (uncaught errors in React).
- `before_send` scrubbing in both: remove request data, user, breadcrumbs with URLs or paths; keep only the
  error kind, app version, macOS version, and a stack trace with file paths reduced to crate/module names.
- Off unless `Send crash and error reports` is on; toggling takes effect at once.

## 5. App: usage statistics

- **Recommended: Aptabase** (`tauri-plugin-aptabase`). It's built for Tauri, cookieless, with no device
  identifiers, and has EU hosting and a free tier. **Alternative:** PostHog (more powerful, heavier, needs care to
  stay anonymous).
- A fixed, short list of events; nothing else is ever sent:

| Event | Properties |
|---|---|
| `app_started` | app version, macOS version (sent by the SDK) |
| `connection_added` | `provider`: s3 / r2 / hetzner |
| `transfer_started` | `direction`: upload / download / copy, `kind`: file / folder, `size`: bucket |
| `transfer_finished` | `direction`, `outcome`: finished / failed / cancelled, `error`: AppError kind |
| `feature_used` | `name`: palette / preview / tabs / drag_drop / size_count / settings |
| `theme_changed` | `theme`: system / light / dark |

- A small `analytics` module in the UI with one function per event, so the allowed fields are fixed by type.

## 6. Decisions for you

1. Website: **Cloudflare Web Analytics** (free, no custom events) or **Plausible** (paid, custom events)?
2. Crash reports: **Sentry**, or nothing for now?
3. Usage stats: **Aptabase**, **PostHog**, or nothing for now?
4. Opt-in (recommended, above) or on by default with a clear switch to turn off?
5. Accounts: these services need sign-ups (Cloudflare, Sentry, Aptabase); their keys are public client keys, but
   they still live in config, never in code comments or logs.

## 7. Build order (after M4)

1. Privacy page on the website, and Cloudflare Web Analytics.
2. Settings switches and the first-launch note (no sending yet).
3. Error reports with scrubbing, and tests that a scrubbed event has no paths, names or keys.
4. Usage events, and tests that each event only carries its listed fields.
