# Kelp design system and website rebuild

Date: 2026-10-14
Status: draft, awaiting review

## 1. Purpose

Give the Kelp app and the landing website one shared visual language, written as real CSS that both projects import, plus HTML reference pages that are easy to copy when building. Then rebuild the website on it.

The work is split into three parts. This spec covers parts 1 and 2.

1. **Foundations**: tokens, fonts, shared components, reference sheet.
2. **Website**: five page types rebuilt on the foundations, with prerendering and SEO.
3. **App screens**: later, its own spec. App-only controls (inputs, file row, dialogs, transfer item) are designed there.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Name | The app is **Kelp** (was "Bucket Browser") |
| Palette | "Deep water": navy dark, sand light, sea-glass teal accent |
| Type | Bricolage Grotesque (display), Hanken Grotesk (body), JetBrains Mono (data) |
| App UI text | System font (SF Pro); brand display font for headings and empty states |
| Design files | HTML/CSS in the repo, no Figma |
| Landing layout | Full-width navy hero fading to teal at a "surface", demo window floating over the edge onto sand |
| Hero motion | Rising bubbles, CSS only |
| Docs layout | Left sidebar, one page per guide |
| Sharing | Root `design/` folder imported by relative path; no npm package |
| Website pages | Vite multi-page (real HTML per page), no router |
| Rendering | Prerendered to static HTML at build time, hydrated by React |
| Hosting | Cloudflare Pages on `kelp.ozanai.dev` (domain already on Cloudflare) |
| Theme | Light and dark on both website and app. Follows the system by default; a System / Light / Dark switch overrides it and is remembered |
| Linting | `tsc` strict only for now; add `eslint-plugin-react-hooks` when the app UI grows |

## 3. Foundations (`design/`)

```
design/
  tokens.css        colour scales, semantic tokens, themes, type, space, radius, shadow, motion
  components.css    shared components (section 3.6)
  fonts/            self-hosted Latin-subset woff2 + fonts.css (@font-face)
  reference/
    index.html      system sheet
    landing.html  docs.html  changelog.html  privacy.html  404.html  og.html
```

Rule: components and page CSS use **semantic tokens only**. No raw hex values, and no raw scale values (`--navy-700`) outside `tokens.css`. If a colour is missing, add a semantic token first.

### 3.1 Colour scales

| Scale | Values |
|---|---|
| Navy | 950 `#08111a`, 900 `#0c1620`, 800 `#122030`, 700 `#1d2c3a`, 600 `#2a4352`, 400 `#7b8fa0`, 200 `#dde7ee` |
| Teal | 700 `#0b5c50`, 600 `#14806f`, 400 `#35c2ad`, 100 `#d9efe9` |
| Sand | 50 `#f5f2ea`, 100 `#ece6d8`, 200 `#e0d9c9`; ink `#0f1d27`; muted `#4a5a65` |
| Status | danger (coral) and warning (amber), exact values chosen to pass AA on both themes; success uses teal |

### 3.2 Semantic tokens and themes

Tokens: `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-hover`, `--on-accent`, `--link`, `--focus`, `--danger`, `--warning`.

- **Light** maps to sand, ink text, teal-600 accent, teal-700 links.
- **Dark** maps to navy, navy-200 text, teal-400 accent (dark text on it), teal-400 links.
- Selectors:
  - `:root` is light.
  - `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` is dark.
  - `:root[data-theme="dark"]` is dark.
  - So with no `data-theme` attribute the page follows the system, even with JavaScript off.
  - `.theme-dark` and `.theme-light` force a theme on one section (and its children) regardless of the page theme.
- Each theme sets `color-scheme`, so native scrollbars and form controls match.
- On the **website** in dark mode, the sand page becomes navy-950 with navy-900 surfaces. Navy sections (`.theme-dark`) keep their teal "surface" gradient and get a `--border` edge, so they don't merge into the page. The `DemoWindow` follows the page theme, so it previews the app in both themes.

Contrast (WCAG AA, 4.5:1 for body text):
- Teal-600 text on sand is about 4.3:1, which fails, so `--link` in light mode is teal-700.
- White on teal-600 is about 4.8:1, which passes, so primary buttons in light mode use it.
- Every text and background pair in the reference sheet is checked before part 1 is called done.

### 3.2.1 Theme switching (shared by website and app)

- `design/theme.ts` (about 25 lines, no dependencies) exports `getThemePreference()` and `setThemePreference("system" | "light" | "dark")`. It stores the choice in `localStorage` under `kelp-theme`. It sets `data-theme` on `<html>` for light or dark, and removes the attribute for system. Both the website and the app import it.
- **No flash of the wrong theme.** Every website HTML page has a short inline script in `<head>` that applies the stored preference before first paint. The app does the same in its `index.html`. In the app, part 3 also calls Tauri's window `setTheme` so the native title bar matches.
- `<meta name="theme-color">` has two versions, one per `prefers-color-scheme`.
- **`.theme-switch` component:** a segmented control of three native radio inputs (System, Light, Dark) with icons, visible labels for screen readers, and arrow-key navigation from the radio group. It sits at the right of the website header, and in the app's settings (part 3). The app also gets a ⌘K command, "Change theme".

### 3.3 Type

- `--font-display`: Bricolage Grotesque (500, 700, 800)
- `--font-body`: Hanken Grotesk (400, 500, 600)
- `--font-mono`: JetBrains Mono (400, 500)
- `--font-ui`: `-apple-system, BlinkMacSystemFont, system-ui, sans-serif` (app only)
- Scale: `--text-xs` 12, `--text-sm` 14, `--text-base` 16, `--text-lg` 20, `--text-xl` 24, `--text-2xl` 32, `--text-3xl` 44, `--text-display` `clamp(44px, 7vw, 80px)`
- Website body size is 17px. App body size is 13px.
- Headings use `line-height: 1.05` and `letter-spacing: -0.02em`. Body text uses 1.6.
- Fonts are self-hosted woff2 files with a Latin subset, `font-display: swap`, and `preload` for the two most-used files. Google Fonts is never loaded at runtime, because the app's CSP forbids it and the app must work offline.

### 3.4 Space, radius, shadow

- Space (4px grid): `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 24, `-6` 32, `-7` 48, `-8` 64, `-9` 96, `-10` 128
- Radius: `--radius-sm` 4, `-md` 6, `-lg` 10, `-xl` 16, `-full` 9999px
- Shadow: `--shadow-sm` (controls), `--shadow-md` (popovers), `--shadow-lg` (windows); tuned per theme

### 3.5 Motion

- `--dur-fast` 120ms, `--dur` 200ms, `--dur-slow` 400ms, `--ease-out` `cubic-bezier(0.2, 0.8, 0.2, 1)`
- Only `transform` and `opacity` are animated.
- Under `prefers-reduced-motion: reduce`, durations are 0 and ambient animation (bubbles) is removed.

### 3.6 Components (`components.css`)

| Class | Variants and states |
|---|---|
| `.button` | `.button-primary` / `-secondary` / `-ghost`; `.button-lg`; hover, active, disabled, focus-visible |
| `.badge` | neutral, `.badge-accent` |
| `.callout` | `.callout-info`, `.callout-warning` |
| `.card` | default, `.card-link` (whole card clickable, hover lift) |
| `code`, `pre`, `kbd` | inline code, code block, key caps |
| `.steps` | numbered `<ol>` with teal number discs |
| `.nav-list` | vertical list; `aria-current="page"` styles the active item |
| `.theme-switch` | System / Light / Dark segmented radio group; checked, focus-visible |
| `.bubbles` | absolutely positioned ambient layer, `aria-hidden`, about 7 bubbles, low contrast |

Focus: every interactive element gets a 2px `--focus` outline with a 2px offset on `:focus-visible`.

### 3.7 Reference sheet (`reference/index.html`)

Side-by-side light and dark panels showing every swatch (with its token name and contrast ratio against `--bg`), the type scale, spacing, radius, shadows, and every component in every state. Opens directly from disk with no build step.

## 4. Website (`website/`)

### 4.1 Structure

```
website/
  index.html                             landing
  docs/index.html                        Getting started
  docs/{s3,r2,hetzner,troubleshooting}/index.html
  changelog/index.html
  privacy/index.html
  404.html
  public/  robots.txt  og.png  favicon.svg
  scripts/prerender.ts                   build-time HTML + sitemap
  src/
    config.ts        names, URLs, version, and the `pages` list (path, title, description)
    site.css         page layout only, semantic tokens only (replaces styles.css)
    components/      Header, Footer, DocsLayout, ArticleLayout, DemoWindow, Bubbles, Seo
    pages/           one entry component per page
    content/         changelog.ts, docs page bodies (TSX)
    data.ts          fake demo data (never real bucket names or keys)
```

`vite.config.ts` lists every HTML file as an entry point and sets `server.fs.allow` to include `../design`. `site.css` imports `../../design/fonts/fonts.css`, `tokens.css` and `components.css`.

### 4.2 Rendering and SEO

- **Prerender.** `npm run build` runs `tsc -b`, then `vite build` for the client, then `vite build --ssr` for the page components, then `scripts/prerender.ts`. For each entry in `pages`, the script calls `renderToString` and writes the result into that page's built HTML. The client entries use `hydrateRoot`. No new runtime dependencies.
- **Per-page meta** comes from `config.pages`: `<title>`, meta description, canonical URL, Open Graph (`og:title`, `og:description`, `og:image`, `og:url`), and Twitter card tags.
- **Sitemap.** `sitemap.xml` is generated by the prerender script from `config.pages`. `robots.txt` allows everything and points at the sitemap.
- **Share image.** `og.png` (1200×630) is designed as `design/reference/og.html` and exported with headless Chrome (`--screenshot --window-size=1200,630`).
- **Structured data.** The landing page has `SoftwareApplication` JSON-LD (name, operatingSystem "macOS 13+", applicationCategory "DeveloperApplication", offers price 0).
- **Semantics.** One `h1` per page, `header`/`nav`/`main`/`footer` landmarks, `lang="en"`, and link text that makes sense on its own.
- **Target.** Lighthouse scores of 95+ in Performance, Accessibility, Best Practices and SEO on every page.

### 4.3 Pages

**Shared header and footer.** The header shows the Kelp wordmark, then Docs, Changelog, GitHub, the theme switch, and a small Download button. On navy sections it uses `.theme-dark`. The footer shows Docs, Changelog, Privacy, GitHub and `kelp.ozanai.dev`.

**Landing** (in order):
1. Header (on navy).
2. Hero (`.theme-dark`): navy gradient fading to teal at the bottom, with bubbles. Headline "Every bucket, one window.", a lede, the Download button, and the macOS requirement note. The interactive `DemoWindow` floats across the hero's bottom edge onto the sand.
3. Provider strip: "Works with Amazon S3 · Cloudflare R2 · Hetzner Object Storage" as text badges. No logos.
4. Features: a grid of 6 cards. The copy must match `SPEC.md`:
   - The ⌘K card says "jump to any bucket or folder or run a command", not file search (search is "Later").
   - Remove the claim that files copy between providers without a download (the S3 API cannot do that).
5. Security band (`.theme-dark`): "Your keys stay in the macOS Keychain", with a link to Privacy.
6. Download: the button, version and requirements, plus install steps. Gatekeeper step: "If macOS says the app can't be checked, open System Settings → Privacy & Security and click Open Anyway." Remove this step once the app is notarised.
7. Footer.

**Docs** (`DocsLayout`): the sidebar is a `.nav-list` with Getting started, Amazon S3, Cloudflare R2, Hetzner and Troubleshooting. The content column is about 68ch wide. Each provider page covers where to create keys, the endpoint and region values, when to use path-style addressing, a `.steps` list for adding the connection in Kelp, and a Keychain `.callout`. Below 768px the sidebar becomes a horizontal scrolling list above the content.

**Changelog** (`ArticleLayout`): rendered from `content/changelog.ts` as `{ version, date, items[] }[]`. While `SITE.released` is false, v0.1.0 shows a "Not released yet" badge.

**Privacy** (`ArticleLayout`): plain language. Secret keys live only in the macOS Keychain. There's no telemetry or analytics. The app only connects to the storage providers you add and to GitHub for update checks. The website sets no cookies.

**404** (`.theme-dark`, full height, bubbles): "This page drifted off." with a link back to the home page.

### 4.4 Rename and config changes

- `website/src/config.ts`:
  - `name: "Kelp"`
  - `domain: "kelp.ozanai.dev"` (placeholder until open question 2 is settled)
  - `repoUrl: "https://github.com/Ozan797/Kelp"`
  - `downloadUrl` built from `version`: `https://github.com/Ozan797/Kelp/releases/download/v${version}/Kelp_${version}_aarch64.dmg`. This matches Tauri's default `{productName}_{version}_{arch}.dmg` name. Check it against the first real draft release.
- Update the name in `release.yml` (`releaseName`), `README.md`, `SPEC.md` and `CLAUDE.md`.
- In `CLAUDE.md`, change "tokens in `src/styles/`" to "tokens in `design/tokens.css`", and add the semantic-tokens-only rule.

### 4.5 Hosting

- The website is deployed to **Cloudflare Pages** with the build command `npm run build`, root `website/` and output `dist/`, on the custom domain `kelp.ozanai.dev`. `404.html` is served automatically.
- The `.dmg` stays on GitHub Releases for now. Cloudflare Pages has a 25 MiB per-file limit, so the `.dmg` cannot be served from Pages. If you want downloads on your own domain later, use an **R2 bucket with a custom domain** (for example `download.ozanai.dev`), uploaded from `release.yml`. That is deferred to milestone M5. Only `downloadUrl` in `config.ts` would change.

## 5. Out of scope

- App screens and app-only components (part 3).
- Auto-update. It is required in the first public release; see `SPEC.md` §9.1. Its "update available" UI is designed in part 3.
- The R2 download bucket (M5).
- A markdown or MDX pipeline for docs. Docs stay as TSX until they outgrow it.
- Analytics.

## 6. Done when

- `design/reference/index.html` shows every token and component in light and dark, and every text pair passes AA.
- `cd website && npm run build` passes and outputs prerendered HTML for every page (the content is visible with JavaScript disabled), plus `sitemap.xml`.
- Every page has been checked in a browser: layout at 375px, 768px and 1280px; keyboard focus visible; bubbles stop under reduced motion.
- Lighthouse scores are 95+ in all four categories on the landing page and one docs page.
- The theme switch works on every page: it follows the system by default, the choice persists across pages and reloads with no flash, and with JavaScript off the page follows the system.
- No raw hex values in `website/src` or `components.css` (checked with grep).
