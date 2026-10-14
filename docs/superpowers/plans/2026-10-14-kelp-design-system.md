# Kelp design system and website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Kelp's shared design system (`design/`) and rebuild the landing website on it, as prerendered static pages with light and dark themes.

**Architecture:** `design/` holds plain CSS tokens and components, self-hosted fonts and a tiny `theme.ts`. The website imports them by relative path. The website is one Vite + React app: a single HTML template plus a path → component registry. During development, Vite serves every path through the template. At build time, `scripts/prerender.mjs` renders each page to its own static HTML file with per-page meta, and the browser then hydrates it.

**Tech Stack:** Plain CSS (custom properties), React 18, TypeScript 5.6 strict, Vite 5, Node 22 (`node:test` with `--experimental-strip-types`), headless Google Chrome for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-14-kelp-design-system-design.md`

**Deviations from the spec (implementation details, same outcome):**
- One HTML template plus a route registry instead of hand-written HTML files per page. The build still outputs real HTML per page (`dist/docs/s3/index.html` and so on).
- The prerender and check scripts are `.mjs`, not `.ts`, to avoid adding a TypeScript runner dependency.
- The `Seo` component becomes `src/head.ts` (a string builder), because head tags are injected by the prerender script, not rendered by React.
- `design/reference/` contains `index.html` (system sheet) and `og.html` only. The built website is the reference for website pages (`npm run build && npm run preview`). **Waiting for the user's confirmation.**

## Global Constraints

- Components and website CSS use **semantic tokens only**. `grep -rnE '#[0-9a-fA-F]{3,8}\b' website/src design/components.css` must print nothing.
- Only `transform` and `opacity` are animated. Under `prefers-reduced-motion: reduce`, durations are 0 and `.bubbles` is hidden.
- No new runtime or dev dependencies. Lighthouse runs through `npx` during verification only.
- Strict TypeScript with no `any`. Use function components and hooks.
- All names, versions and URLs live in `website/src/config.ts`.
- `SITE.released` stays `false`.
- The demo uses fake data only (`website/src/data.ts`).
- Fonts are self-hosted from `design/fonts/`. Google Fonts must never be loaded at runtime.
- WebKit on macOS 13 must work: no `color-mix()` and no `light-dark()`. `:has()` is fine.
- UI copy is sentence case, active voice and plain words. Buttons say exactly what they do.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Stored theme is garbage or storage is blocked** (Safari private mode, strict settings). Expect: falls back to "system" without throwing. Tested in Task 3.
2. **The two dark-theme blocks drift apart**. Dark is declared twice: once for `[data-theme="dark"]` and once inside the `prefers-color-scheme` media query. Expect: they are identical. Asserted by `check-contrast.mjs` in Task 2.
3. **Hydration mismatch from the theme switch**. The server can't know the stored theme. Expect: the server renders "system" as checked, and the client reads storage in `useEffect`. Asserted by `check-dist.mjs` in Task 7.
4. **The same page reached by `/docs/s3`, `/docs/s3/` or `/docs/s3/index.html`, and unknown paths served `404.html`**. Expect: the first three hydrate the S3 page, and unknown paths hydrate NotFound, not the landing page. Tested in Task 6 (`path.test.ts`).
5. **Muted text over the bottom of the hero gradient** fails AA (3.69:1 on `--teal-800`). Expect: no text sits in the bottom 35% of a gradient band. Checked visually in Task 13. Keep the hero's `padding-bottom` for the demo overlap only.

---

### Task 1: Self-hosted fonts

**Files:**
- Create: `design/fonts/bricolage-grotesque-latin.woff2`, `design/fonts/hanken-grotesk-latin.woff2`, `design/fonts/jetbrains-mono-latin.woff2`
- Create: `design/fonts/OFL-bricolage-grotesque.txt`, `design/fonts/OFL-hanken-grotesk.txt`, `design/fonts/OFL-jetbrains-mono.txt`
- Create: `design/fonts/fonts.css`

**Interfaces:**
- Produces: font families `"Bricolage Grotesque"` (weights 500–800), `"Hanken Grotesk"` (400–600) and `"JetBrains Mono"` (400–500), declared in `design/fonts/fonts.css`.

- [ ] **Step 1: Write the check (it fails because the files don't exist yet)**

Run from the repo root:
```bash
for f in bricolage-grotesque hanken-grotesk jetbrains-mono; do
  [ "$(head -c 4 design/fonts/$f-latin.woff2 2>/dev/null)" = "wOF2" ] && echo "ok $f" || echo "MISSING $f"
done
```
Expected: three `MISSING` lines.

- [ ] **Step 2: Download the Latin-subset variable fonts and licences**

Google's CSS API returns a single variable woff2 file per subset when you request a weight range. A Safari user agent makes it return woff2.
```bash
mkdir -p design/fonts && cd design/fonts
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
get() {
  url=$(curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" \
    | awk '/\/\* latin \*\//{f=1} f && /src:/{match($0,/https:[^)]+/); print substr($0,RSTART,RLENGTH); exit}')
  curl -s -o "$2" "$url"
}
get "Bricolage+Grotesque:opsz,wght@12..96,500..800" bricolage-grotesque-latin.woff2
get "Hanken+Grotesk:wght@400..600" hanken-grotesk-latin.woff2
get "JetBrains+Mono:wght@400..500" jetbrains-mono-latin.woff2
curl -s -o OFL-bricolage-grotesque.txt https://raw.githubusercontent.com/google/fonts/main/ofl/bricolagegrotesque/OFL.txt
curl -s -o OFL-hanken-grotesk.txt https://raw.githubusercontent.com/google/fonts/main/ofl/hankengrotesk/OFL.txt
curl -s -o OFL-jetbrains-mono.txt https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt
cd ../..
head -3 design/fonts/OFL-*.txt
```
Expected: each OFL file starts with a copyright line. If any file contains `404: Not Found`, look the folder name up at https://github.com/google/fonts/tree/main/ofl and retry.

- [ ] **Step 3: Write `design/fonts/fonts.css`**

```css
/* Kelp fonts. Latin subset, variable weight, licensed under the SIL Open Font License (see OFL-*.txt). */

@font-face {
  font-family: "Bricolage Grotesque";
  src: url("./bricolage-grotesque-latin.woff2") format("woff2");
  font-weight: 500 800;
  font-display: swap;
}

@font-face {
  font-family: "Hanken Grotesk";
  src: url("./hanken-grotesk-latin.woff2") format("woff2");
  font-weight: 400 600;
  font-display: swap;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("./jetbrains-mono-latin.woff2") format("woff2");
  font-weight: 400 500;
  font-display: swap;
}
```

- [ ] **Step 4: Run the check from Step 1 again**

Expected: `ok bricolage-grotesque`, `ok hanken-grotesk`, `ok jetbrains-mono`.

- [ ] **Step 5: Commit**

```bash
git add design/fonts
git commit -m "Add self-hosted Kelp fonts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Design tokens and contrast check

**Files:**
- Create: `design/check-contrast.mjs`
- Create: `design/tokens.css`

**Interfaces:**
- Produces these semantic tokens, used by every later task:
  - Colour: `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-hover`, `--on-accent`, `--accent-soft`, `--on-accent-soft`, `--link`, `--focus`, `--danger`, `--warning`, `--warning-soft`
  - Effects: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--bubble-border`, `--bubble-fill`
  - Unthemed: `--band-top`, `--hero-gradient`, `--provider-s3`, `--provider-r2`, `--provider-hetzner`
  - Fonts: `--font-display`, `--font-body`, `--font-mono`, `--font-ui`
  - Type scale: `--text-xs` … `--text-3xl`, `--text-display`
  - Space, radius, motion: `--space-1` … `--space-10`, `--radius-sm|md|lg|xl|full`, `--dur-fast`, `--dur`, `--dur-slow`, `--ease-out`
- Theme classes: `.theme-light` and `.theme-dark`. Root attribute: `data-theme="light"|"dark"`.

- [ ] **Step 1: Write the failing check `design/check-contrast.mjs`**

```js
// Checks WCAG AA contrast for Kelp's semantic colour pairs in both themes,
// and that the dark theme is declared identically in its two places.
// Run: node design/check-contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** Returns { "--name": "value" } for the first block whose selector is exactly `selector`. */
function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`tokens.css is missing the block: ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const scales = block(":root");
const themes = {
  light: block(":root, .theme-light"),
  dark: block(':root[data-theme="dark"], .theme-dark'),
};
const darkMedia = block(':root:not([data-theme="light"])');

function resolve(value) {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return value;
  if (!(ref[1] in scales)) throw new Error(`Unknown token ${ref[1]}`);
  return resolve(scales[ref[1]]);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// [foreground, background, minimum]. 4.5 for text, 3 for focus rings.
const PAIRS = [
  ["--text", "--bg", 4.5],
  ["--text", "--surface", 4.5],
  ["--text", "--surface-raised", 4.5],
  ["--text-muted", "--bg", 4.5],
  ["--text-muted", "--surface", 4.5],
  ["--text-muted", "--surface-raised", 4.5],
  ["--link", "--bg", 4.5],
  ["--link", "--surface-raised", 4.5],
  ["--on-accent", "--accent", 4.5],
  ["--on-accent", "--accent-hover", 4.5],
  ["--on-accent-soft", "--accent-soft", 4.5],
  ["--danger", "--bg", 4.5],
  ["--warning", "--bg", 4.5],
  ["--text", "--warning-soft", 4.5],
  ["--focus", "--bg", 3],
];

let failed = false;
for (const [name, tokens] of Object.entries(themes)) {
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(resolve(tokens[fg]), resolve(tokens[bg]));
    const ok = r >= min;
    failed ||= !ok;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}

if (JSON.stringify(themes.dark) !== JSON.stringify(darkMedia)) {
  failed = true;
  console.log("FAIL the dark theme block and the prefers-color-scheme block differ");
}

process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it to verify that it fails**

Run: `node design/check-contrast.mjs`
Expected: it exits with an `ENOENT ... tokens.css` error.

- [ ] **Step 3: Write `design/tokens.css`**

Keep each theme selector on one line. The check script finds blocks by their exact selector text.
```css
/*
 * Kelp design tokens, shared by the app and the website.
 * Components use the semantic tokens (section 2) only. Never use the raw scales outside this file.
 * Dark is declared twice (explicit choice and system preference). design/check-contrast.mjs keeps them identical.
 */

/* 1. Raw scales and unthemed tokens */
:root {
  --navy-950: #08111a;
  --navy-900: #0c1620;
  --navy-800: #122030;
  --navy-700: #1d2c3a;
  --navy-600: #2a4352;
  --navy-400: #7b8fa0;
  --navy-200: #dde7ee;

  --teal-900: #0f3a36;
  --teal-800: #123a3f;
  --teal-700: #0b5c50;
  --teal-600: #14806f;
  --teal-400: #35c2ad;
  --teal-300: #5fd6c4;
  --teal-100: #d9efe9;
  --teal-ink: #04140f;

  --sand-50: #f5f2ea;
  --sand-100: #ece6d8;
  --sand-200: #e0d9c9;
  --ink-900: #0f1d27;
  --ink-600: #4a5a65;
  --white: #ffffff;

  --coral-600: #c4373b;
  --coral-400: #ff7a6e;
  --amber-900: #2e2410;
  --amber-700: #8a5a00;
  --amber-400: #f0b545;
  --amber-100: #f7ead0;

  /* Unthemed brand surfaces: navy bands look the same in both themes */
  --band-top: #08111a;
  --hero-gradient: linear-gradient(180deg, #08111a 0%, #0c1620 65%, #123a3f 100%);

  /* Provider marks (sidebar dots) */
  --provider-s3: #f2a93b;
  --provider-r2: #f27d4b;
  --provider-hetzner: #e2475a;

  /* Type */
  --font-display: "Bricolage Grotesque", system-ui, sans-serif;
  --font-body: "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --font-ui: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --text-3xl: 2.75rem;
  --text-display: clamp(2.75rem, 7vw, 5rem);

  /* Space (4px grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
  --space-10: 128px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Motion */
  --dur-fast: 120ms;
  --dur: 200ms;
  --dur-slow: 400ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* 2. Semantic tokens: light (default) */
:root, .theme-light {
  color-scheme: light;
  --bg: var(--sand-50);
  --surface: var(--sand-100);
  --surface-raised: var(--white);
  --border: var(--sand-200);
  --text: var(--ink-900);
  --text-muted: var(--ink-600);
  --accent: var(--teal-600);
  --accent-hover: var(--teal-700);
  --on-accent: var(--white);
  --accent-soft: var(--teal-100);
  --on-accent-soft: var(--teal-700);
  --link: var(--teal-700);
  --focus: var(--teal-600);
  --danger: var(--coral-600);
  --warning: var(--amber-700);
  --warning-soft: var(--amber-100);
  --shadow-sm: 0 1px 2px rgba(15, 29, 39, 0.08);
  --shadow-md: 0 6px 20px rgba(15, 29, 39, 0.12);
  --shadow-lg: 0 30px 70px rgba(8, 17, 26, 0.28);
  --bubble-border: rgba(53, 194, 173, 0.6);
  --bubble-fill: rgba(53, 194, 173, 0.13);
}

/* 3. Semantic tokens: dark, chosen explicitly or forced on a section */
:root[data-theme="dark"], .theme-dark {
  color-scheme: dark;
  --bg: var(--navy-950);
  --surface: var(--navy-900);
  --surface-raised: var(--navy-800);
  --border: var(--navy-700);
  --text: var(--navy-200);
  --text-muted: var(--navy-400);
  --accent: var(--teal-400);
  --accent-hover: var(--teal-300);
  --on-accent: var(--teal-ink);
  --accent-soft: var(--teal-900);
  --on-accent-soft: var(--teal-400);
  --link: var(--teal-400);
  --focus: var(--teal-400);
  --danger: var(--coral-400);
  --warning: var(--amber-400);
  --warning-soft: var(--amber-900);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 30px 80px rgba(0, 0, 0, 0.55);
  --bubble-border: rgba(53, 194, 173, 0.6);
  --bubble-fill: rgba(53, 194, 173, 0.13);
}

/* 4. Semantic tokens: dark, from the system (keep identical to section 3) */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: var(--navy-950);
    --surface: var(--navy-900);
    --surface-raised: var(--navy-800);
    --border: var(--navy-700);
    --text: var(--navy-200);
    --text-muted: var(--navy-400);
    --accent: var(--teal-400);
    --accent-hover: var(--teal-300);
    --on-accent: var(--teal-ink);
    --accent-soft: var(--teal-900);
    --on-accent-soft: var(--teal-400);
    --link: var(--teal-400);
    --focus: var(--teal-400);
    --danger: var(--coral-400);
    --warning: var(--amber-400);
    --warning-soft: var(--amber-900);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.45);
    --shadow-lg: 0 30px 80px rgba(0, 0, 0, 0.55);
    --bubble-border: rgba(53, 194, 173, 0.6);
    --bubble-fill: rgba(53, 194, 173, 0.13);
  }
}

/* A themed section must re-resolve its text colour; inherited `color` is already computed. */
.theme-light,
.theme-dark {
  color: var(--text);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-fast: 0ms;
    --dur: 0ms;
    --dur-slow: 0ms;
  }
}
```

- [ ] **Step 4: Run the check to verify that it passes**

Run: `node design/check-contrast.mjs`
Expected: 30 `ok` lines, no `FAIL`, exit code 0. The lowest ratios are about 4.3 for focus in light mode, 4.74 for danger on the light background, and 4.83 for white text on teal-600.

- [ ] **Step 5: Prove that the drift check works, then undo**

Change `--text: var(--navy-200);` to `--text: var(--white);` **in section 4 only**. Run `node design/check-contrast.mjs`. Expected: `FAIL the dark theme block and the prefers-color-scheme block differ`. Revert the change and run again. Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add design/tokens.css design/check-contrast.mjs
git commit -m "Add Kelp design tokens with contrast check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared theme preference (`theme.ts`)

**Files:**
- Create: `design/theme.test.ts`
- Create: `design/theme.ts`

**Interfaces:**
- Produces:
  - `type ThemePreference = "system" | "light" | "dark"`
  - `getThemePreference(): ThemePreference`
  - `setThemePreference(pref: ThemePreference): void`
- localStorage key: `"kelp-theme"`. The inline `<head>` script in Task 6 uses the same key and the same values.

- [ ] **Step 1: Write the failing test `design/theme.test.ts`**

```ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal stand-ins for the browser objects theme.ts touches.
const store = new Map<string, string>();
let storageBroken = false;
const root = { dataset: {} as Record<string, string | undefined> };

function guard() {
  if (storageBroken) throw new Error("SecurityError: storage is blocked");
}

Object.assign(globalThis, {
  document: { documentElement: root },
  localStorage: {
    getItem: (k: string) => (guard(), store.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void store.set(k, v)),
    removeItem: (k: string) => (guard(), void store.delete(k)),
  },
});

const { getThemePreference, setThemePreference } = await import("./theme.ts");

beforeEach(() => {
  store.clear();
  storageBroken = false;
  delete root.dataset.theme;
});

test("defaults to system", () => {
  assert.equal(getThemePreference(), "system");
});

test("dark is applied to <html> and remembered", () => {
  setThemePreference("dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(store.get("kelp-theme"), "dark");
  assert.equal(getThemePreference(), "dark");
});

test("system removes the attribute and the stored value", () => {
  setThemePreference("light");
  setThemePreference("system");
  assert.equal(root.dataset.theme, undefined);
  assert.equal(store.has("kelp-theme"), false);
  assert.equal(getThemePreference(), "system");
});

test("an unknown stored value falls back to system", () => {
  store.set("kelp-theme", "purple");
  assert.equal(getThemePreference(), "system");
});

test("blocked storage falls back to system and still applies the theme", () => {
  storageBroken = true;
  assert.equal(getThemePreference(), "system");
  setThemePreference("dark");
  assert.equal(root.dataset.theme, "dark");
});
```

- [ ] **Step 2: Run it to verify that it fails**

Run: `node --test --experimental-strip-types design/theme.test.ts`
Expected: FAIL with `Cannot find module ... design/theme.ts`.

- [ ] **Step 3: Write `design/theme.ts`**

```ts
/**
 * Theme preference shared by the Kelp website and app.
 * "system" follows macOS. "light" and "dark" override it and are remembered.
 * The CSS in tokens.css reacts to the `data-theme` attribute on <html>.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "kelp-theme";

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system"; // storage blocked (private browsing, strict settings)
  }
}

export function setThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;

  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Not remembered, but still applied to this page.
  }
}
```

- [ ] **Step 4: Run the test to verify that it passes**

Run: `node --test --experimental-strip-types design/theme.test.ts`
Expected: `# pass 5`, `# fail 0`. An `ExperimentalWarning` about type stripping is normal on Node 22.

- [ ] **Step 5: Commit**

```bash
git add design/theme.ts design/theme.test.ts
git commit -m "Add shared theme preference helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared components (`components.css`)

**Files:**
- Create: `design/components.css`

**Interfaces:**
- Consumes: the semantic tokens from Task 2.
- Produces these classes:
  - `.button` with `.button-primary`, `.button-secondary`, `.button-ghost` and `.button-lg`
  - `.badge` and `.badge-accent`
  - `.callout` with `.callout-info` and `.callout-warning`
  - `.card` and `.card-link`
  - Element styles for `code`, `pre` and `kbd`
  - `.steps` (use `<ol class="steps" role="list">`)
  - `.nav-list` (style the active link with `aria-current="page"`)
  - `.theme-switch`: a `<fieldset>` of `<label>`s, each wrapping an `<input type="radio" class="visually-hidden">`, an icon `<svg>` and a `<span class="visually-hidden">` label
  - `.bubbles`: a container of `<span>`s that take `--x`, `--size`, `--d` and `--delay` as CSS variables
  - `.visually-hidden`
  - A global `:focus-visible` ring

- [ ] **Step 1: Write the failing check (it fails because the file doesn't exist yet)**

Run: `test -f design/components.css && ! grep -nE '#[0-9a-fA-F]{3,8}\b' design/components.css && echo PASS || echo FAIL`
Expected: `FAIL`.

- [ ] **Step 2: Write `design/components.css`**

```css
/* Kelp shared components. Semantic tokens only (see tokens.css). */

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* Button */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font: 600 var(--text-sm) / 1 var(--font-body);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out);
}

.button:active:not(:disabled, [aria-disabled="true"]) {
  transform: translateY(1px);
}

.button:disabled,
.button[aria-disabled="true"] {
  opacity: 0.55;
  cursor: not-allowed;
}

.button-primary {
  background: var(--accent);
  color: var(--on-accent);
}

.button-primary:hover:not(:disabled, [aria-disabled="true"]) {
  background: var(--accent-hover);
}

.button-secondary {
  background: var(--surface-raised);
  border-color: var(--border);
  color: var(--text);
}

.button-secondary:hover:not(:disabled, [aria-disabled="true"]) {
  border-color: var(--text-muted);
}

.button-ghost {
  background: transparent;
  color: var(--text);
}

.button-ghost:hover:not(:disabled, [aria-disabled="true"]) {
  background: var(--surface);
}

.button-lg {
  min-height: 48px;
  padding: 0 var(--space-5);
  border-radius: var(--radius-lg);
  font-size: var(--text-base);
}

/* Badge */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-muted);
  font: 500 var(--text-xs) / 1.6 var(--font-body);
}

.badge-accent {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--on-accent-soft);
}

/* Callout */
.callout {
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

.callout-info {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--on-accent-soft);
}

.callout-warning {
  border-color: var(--warning);
  background: var(--warning-soft);
  color: var(--text);
}

/* Card */
.card {
  padding: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}

.card-link {
  display: block;
  color: inherit;
  text-decoration: none;
  transition: transform var(--dur) var(--ease-out);
}

.card-link:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

/* Code */
code,
pre,
kbd {
  font-family: var(--font-mono);
  font-size: 0.875em;
}

:not(pre) > code {
  padding: 0.1em 0.35em;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

pre {
  overflow-x: auto;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  line-height: 1.5;
}

kbd {
  display: inline-block;
  min-width: 1.6em;
  padding: 0.1em 0.4em;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text);
  text-align: center;
}

/* Steps: use <ol class="steps" role="list"> so VoiceOver still announces a list */
.steps {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.steps > li {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: var(--space-3);
  counter-increment: step;
}

.steps > li::before {
  content: counter(step);
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--on-accent);
  font: 600 var(--text-xs) / 24px var(--font-body);
  text-align: center;
}

/* Nav list: mark the current page with aria-current="page" */
.nav-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav-list a {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-decoration: none;
}

.nav-list a:hover {
  background: var(--surface);
  color: var(--text);
}

.nav-list a[aria-current="page"] {
  background: var(--accent-soft);
  color: var(--on-accent-soft);
  font-weight: 600;
}

/* Theme switch: System / Light / Dark radio group */
.theme-switch {
  display: inline-flex;
  gap: 2px;
  margin: 0;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
}

.theme-switch label {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  color: var(--text-muted);
  cursor: pointer;
}

.theme-switch label:hover {
  color: var(--text);
}

.theme-switch label:has(input:checked) {
  background: var(--surface-raised);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.theme-switch label:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.theme-switch svg {
  width: 16px;
  height: 16px;
}

/* Bubbles: ambient layer for navy bands. Each <span> sets --x, --size, --d, --delay. */
.bubbles {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.bubbles span {
  position: absolute;
  bottom: -16px;
  left: var(--x, 50%);
  width: var(--size, 6px);
  height: var(--size, 6px);
  border: 1px solid var(--bubble-border);
  border-radius: 50%;
  background: var(--bubble-fill);
  opacity: 0;
  animation: kelp-rise var(--d, 9s) linear var(--delay, 0s) infinite;
}

@keyframes kelp-rise {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  50% {
    transform: translate(6px, -45vh);
  }
  100% {
    transform: translate(-4px, -90vh);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bubbles {
    display: none;
  }
}
```

- [ ] **Step 3: Run the check from Step 1 again**

Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add design/components.css
git commit -m "Add Kelp shared components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reference sheet

**Files:**
- Create: `design/reference/index.html`

**Interfaces:**
- Consumes: `../fonts/fonts.css`, `../tokens.css`, `../components.css`.
- Viewing: Chrome blocks fonts on `file://`, so serve the folder with `python3 -m http.server 8000 -d design` and open `http://localhost:8000/reference/`.

- [ ] **Step 1: Write `design/reference/index.html`**

The sheet is written once in a `<template>`. A script clones it into a light panel and a dark panel and fills in each colour's contrast ratio against that panel's `--bg`.
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kelp design system</title>
    <!-- Serve with: python3 -m http.server 8000 -d design, then open http://localhost:8000/reference/ -->
    <link rel="stylesheet" href="../fonts/fonts.css" />
    <link rel="stylesheet" href="../tokens.css" />
    <link rel="stylesheet" href="../components.css" />
    <style>
      body { margin: 0; font: 400 15px/1.6 var(--font-body); }
      .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(560px, 1fr)); }
      .panel { padding: var(--space-6); background: var(--bg); color: var(--text); }
      .panel > h1 { font: 700 var(--text-2xl) / 1.1 var(--font-display); margin: 0 0 var(--space-6); }
      .sheet h2 { font: 700 var(--text-lg) / 1.1 var(--font-display); margin: var(--space-7) 0 var(--space-4); }
      .row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
      .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); }
      .swatch { display: grid; gap: 2px; font-size: var(--text-xs); }
      .chip { height: 48px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--c); }
      .ratio { color: var(--text-muted); }
      .type-row { display: flex; gap: var(--space-4); align-items: baseline; }
      .type-row code { width: 120px; flex: none; color: var(--text-muted); }
      .space-bar { height: 12px; background: var(--accent); border-radius: 2px; }
      .box { width: 96px; height: 64px; display: grid; place-items: center; background: var(--surface-raised); border: 1px solid var(--border); font-size: var(--text-xs); }
      .band-demo { position: relative; height: 200px; border-radius: var(--radius-lg); background: var(--hero-gradient); overflow: hidden; }
    </style>
  </head>
  <body>
    <div class="panels">
      <section class="panel theme-light"><h1>Kelp · light</h1></section>
      <section class="panel theme-dark"><h1>Kelp · dark</h1></section>
    </div>

    <template id="sheet">
      <div class="sheet">
        <h2>Colour</h2>
        <div class="swatches">
          <div class="swatch" style="--c: var(--bg)"><span class="chip"></span><code>--bg</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--surface)"><span class="chip"></span><code>--surface</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--surface-raised)"><span class="chip"></span><code>--surface-raised</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--border)"><span class="chip"></span><code>--border</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--text)"><span class="chip"></span><code>--text</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--text-muted)"><span class="chip"></span><code>--text-muted</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--accent)"><span class="chip"></span><code>--accent</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--accent-hover)"><span class="chip"></span><code>--accent-hover</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--on-accent)"><span class="chip"></span><code>--on-accent</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--accent-soft)"><span class="chip"></span><code>--accent-soft</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--on-accent-soft)"><span class="chip"></span><code>--on-accent-soft</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--link)"><span class="chip"></span><code>--link</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--focus)"><span class="chip"></span><code>--focus</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--danger)"><span class="chip"></span><code>--danger</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--warning)"><span class="chip"></span><code>--warning</code><span class="ratio"></span></div>
          <div class="swatch" style="--c: var(--warning-soft)"><span class="chip"></span><code>--warning-soft</code><span class="ratio"></span></div>
        </div>

        <h2>Type</h2>
        <div class="type-row"><code>display / 800</code><span style="font: 800 var(--text-display) / 1 var(--font-display); letter-spacing: -0.02em">Kelp</span></div>
        <div class="type-row"><code>3xl / display</code><span style="font: 700 var(--text-3xl) / 1.05 var(--font-display)">Every bucket</span></div>
        <div class="type-row"><code>2xl / display</code><span style="font: 700 var(--text-2xl) / 1.1 var(--font-display)">Connect Amazon S3</span></div>
        <div class="type-row"><code>xl / display</code><span style="font: 700 var(--text-xl) / 1.2 var(--font-display)">Create an access key</span></div>
        <div class="type-row"><code>lg / body</code><span style="font-size: var(--text-lg)">A fast Mac app for your buckets.</span></div>
        <div class="type-row"><code>base / body</code><span style="font-size: var(--text-base)">Files move directly between your Mac and your provider.</span></div>
        <div class="type-row"><code>sm / body</code><span style="font-size: var(--text-sm)">For Apple Silicon Macs, macOS 13 or later.</span></div>
        <div class="type-row"><code>xs / body</code><span style="font-size: var(--text-xs)">Updated today</span></div>
        <div class="type-row"><code>mono</code><code>media-cdn/videos/walkthrough.mp4 · 512 MB</code></div>
        <div class="type-row"><code>ui (app)</code><span style="font: 400 13px / 1.4 var(--font-ui)">launch-teaser.mp4 — SF Pro, app UI text</span></div>

        <h2>Space</h2>
        <div style="display: grid; gap: var(--space-2)">
          <div class="space-bar" style="width: var(--space-1)"></div>
          <div class="space-bar" style="width: var(--space-2)"></div>
          <div class="space-bar" style="width: var(--space-3)"></div>
          <div class="space-bar" style="width: var(--space-4)"></div>
          <div class="space-bar" style="width: var(--space-5)"></div>
          <div class="space-bar" style="width: var(--space-6)"></div>
          <div class="space-bar" style="width: var(--space-7)"></div>
          <div class="space-bar" style="width: var(--space-8)"></div>
          <div class="space-bar" style="width: var(--space-9)"></div>
          <div class="space-bar" style="width: var(--space-10)"></div>
        </div>

        <h2>Radius and shadow</h2>
        <div class="row">
          <div class="box" style="border-radius: var(--radius-sm)">sm</div>
          <div class="box" style="border-radius: var(--radius-md)">md</div>
          <div class="box" style="border-radius: var(--radius-lg)">lg</div>
          <div class="box" style="border-radius: var(--radius-xl)">xl</div>
          <div class="box" style="border-radius: var(--radius-md); box-shadow: var(--shadow-sm)">shadow-sm</div>
          <div class="box" style="border-radius: var(--radius-md); box-shadow: var(--shadow-md)">shadow-md</div>
          <div class="box" style="border-radius: var(--radius-md); box-shadow: var(--shadow-lg)">shadow-lg</div>
        </div>

        <h2>Buttons</h2>
        <div class="row">
          <button class="button button-primary" type="button">Upload files</button>
          <button class="button button-secondary" type="button">New folder</button>
          <button class="button button-ghost" type="button">Cancel</button>
          <button class="button button-primary" type="button" disabled>Delete 3 files</button>
          <a class="button button-primary button-lg" href="#">Download for Mac</a>
          <span class="button button-secondary button-lg" aria-disabled="true">Download coming soon</span>
        </div>
        <p style="color: var(--text-muted); font-size: var(--text-sm)">Hover and press with the mouse, and Tab through to see focus rings.</p>

        <h2>Badges and callouts</h2>
        <div class="row"><span class="badge">Amazon S3</span><span class="badge">Cloudflare R2</span><span class="badge badge-accent">Latest</span></div>
        <p class="callout callout-info">Kelp saves your secret access key in the macOS Keychain.</p>
        <p class="callout callout-warning">Deleting a folder deletes every file inside it.</p>

        <h2>Cards</h2>
        <div class="row" style="align-items: stretch">
          <div class="card" style="max-width: 260px"><strong>Transfers that survive bad Wi-Fi</strong><p style="margin: var(--space-2) 0 0; color: var(--text-muted)">Large files move in parallel pieces.</p></div>
          <a class="card card-link" href="#" style="max-width: 260px"><strong>Cloudflare R2</strong><p style="margin: var(--space-2) 0 0; color: var(--text-muted)">Account ID, endpoint and tokens.</p></a>
        </div>

        <h2>Code and keys</h2>
        <p>Set the region to <code>auto</code> and press <kbd>⌘</kbd> <kbd>K</kbd> to jump anywhere.</p>
        <pre><code>https://&lt;ACCOUNT_ID&gt;.r2.cloudflarestorage.com</code></pre>

        <h2>Steps</h2>
        <ol class="steps" role="list">
          <li>Download the <code>.dmg</code> file.</li>
          <li>Open it and drag Kelp into your Applications folder.</li>
          <li>Open Kelp and add your first connection.</li>
        </ol>

        <h2>Nav list</h2>
        <ul class="nav-list" role="list" style="max-width: 220px">
          <li><a href="#">Getting started</a></li>
          <li><a href="#" aria-current="page">Amazon S3</a></li>
          <li><a href="#">Cloudflare R2</a></li>
        </ul>

        <h2>Theme switch</h2>
        <fieldset class="theme-switch">
          <legend class="visually-hidden">Theme</legend>
          <label title="System"><input class="visually-hidden" type="radio" name="theme" value="system" checked /><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" /><path d="M5.5 14h5M8 11.5V14" /></svg><span class="visually-hidden">System</span></label>
          <label title="Light"><input class="visually-hidden" type="radio" name="theme" value="light" /><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" /></svg><span class="visually-hidden">Light</span></label>
          <label title="Dark"><input class="visually-hidden" type="radio" name="theme" value="dark" /><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" /></svg><span class="visually-hidden">Dark</span></label>
        </fieldset>

        <h2>Bubbles on a navy band</h2>
        <div class="band-demo theme-dark">
          <div class="bubbles" aria-hidden="true">
            <span style="--x: 8%; --size: 6px; --d: 9s; --delay: 0s"></span>
            <span style="--x: 18%; --size: 4px; --d: 7s; --delay: -3s"></span>
            <span style="--x: 31%; --size: 6px; --d: 11s; --delay: -6s"></span>
            <span style="--x: 61%; --size: 3px; --d: 6s; --delay: -1s"></span>
            <span style="--x: 72%; --size: 8px; --d: 9s; --delay: -2s"></span>
            <span style="--x: 83%; --size: 4px; --d: 8s; --delay: -5s"></span>
            <span style="--x: 92%; --size: 6px; --d: 12s; --delay: -8s"></span>
          </div>
        </div>
      </div>
    </template>

    <script>
      // Clone the sheet into both panels, then label each colour with its contrast against the panel background.
      const luminance = (rgb) =>
        rgb.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

      document.querySelectorAll(".panel").forEach((panel, i) => {
        const sheet = document.getElementById("sheet").content.cloneNode(true);
        sheet.querySelectorAll("input[name]").forEach((input) => (input.name += i));
        panel.append(sheet);
        const bg = luminance(getComputedStyle(panel).backgroundColor);
        panel.querySelectorAll(".swatch").forEach((swatch) => {
          const c = luminance(getComputedStyle(swatch.querySelector(".chip")).backgroundColor);
          const ratio = (Math.max(bg, c) + 0.05) / (Math.min(bg, c) + 0.05);
          swatch.querySelector(".ratio").textContent = `${ratio.toFixed(2)} on --bg`;
        });
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Screenshot it and look**

```bash
python3 -m http.server 8000 -d design >/dev/null 2>&1 &
SERVER=$!
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=3000 \
  --window-size=1280,4200 --screenshot="$TMPDIR/kelp-reference.png" http://localhost:8000/reference/
kill $SERVER
```
Open `$TMPDIR/kelp-reference.png` with the Read tool. Expected:
- Two panels, sand and navy.
- Headings in Bricolage (a rounded, quirky grotesque, not Times or Arial).
- Every swatch shows a ratio.
- Buttons, badges, callouts, steps and the nav list look right in both panels.
- The bubbles band is navy. If the fonts look like the system fallback, the server wasn't running.

- [ ] **Step 3: Commit**

```bash
git add design/reference/index.html
git commit -m "Add design system reference sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Website build pipeline (prerender, meta, sitemap)

This task changes the plumbing only. The landing page keeps its old look until Task 8.

**Files:**
- Modify: `website/src/config.ts` (full rewrite)
- Create: `website/src/path.ts`, `website/tests/path.test.ts`
- Create: `website/src/head.ts`, `website/src/routes.tsx`, `website/src/render.tsx`
- Create: `website/src/pages/NotFound.tsx` (simple version; restyled in Task 7)
- Modify: `website/src/main.tsx` (full rewrite)
- Modify: `website/src/App.tsx:38-51` (use `DOWNLOAD_URL`)
- Modify: `website/index.html` (becomes the template)
- Modify: `website/vite.config.ts`, `website/package.json` (scripts), `.gitignore`
- Create: `website/scripts/prerender.mjs`, `website/scripts/check-dist.mjs`

**Interfaces:**
- Produces from `config.ts`:
  - `SITE: { name, domain, url, version, released, repoUrl, minMacOS }`
  - `DOWNLOAD_URL: string`
  - `type PageMeta = { path: string; title: string; description: string }`
  - `PAGES` (`as const`) and `type PagePath`
  - `NOT_FOUND: PageMeta` (path `"/404"`)
  - `hrefFor(path: string): string`, which returns `"/"` or `path + "/"`
  - `pageUrl(path: string): string`, which returns `SITE.url + hrefFor(path)`
- Produces `normalizePath(path: string): string` from `path.ts`.
- Produces `headFor(path: string): string` and `escapeHtml(s: string): string` from `head.ts`.
- Produces `pageFor(path: string): ComponentType` from `routes.tsx`.
- Produces `render(path)`, which returns `{ html, head }`, from `render.tsx`. It also re-exports `PAGES`, `NOT_FOUND`, `SITE`, `pageUrl` and `escapeHtml`.
- Adding a page in later tasks means adding a `PAGES` entry plus a `ROUTES` entry. TypeScript forces both.

- [ ] **Step 1: Write the failing path test `website/tests/path.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePath } from "../src/path.ts";

test("the home page in every form", () => {
  for (const p of ["/", "", "/index.html"]) assert.equal(normalizePath(p), "/");
});

test("a page with or without a trailing slash or index.html", () => {
  for (const p of ["/docs/s3", "/docs/s3/", "/docs/s3/index.html", "/docs/s3//"]) {
    assert.equal(normalizePath(p), "/docs/s3");
  }
});

test("unknown paths stay unknown, so they render NotFound and not the home page", () => {
  assert.equal(normalizePath("/nope"), "/nope");
  assert.equal(normalizePath("/404.html"), "/404.html");
});
```

- [ ] **Step 2: Run it to verify that it fails**

Run: `cd website && node --test --experimental-strip-types tests/path.test.ts`
Expected: FAIL with `Cannot find module ... src/path.ts`.

- [ ] **Step 3: Write `website/src/path.ts`**

```ts
/** Turns "/docs/s3/", "/docs/s3/index.html" and "/docs/s3" into "/docs/s3". */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/index\.html$/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
```

- [ ] **Step 4: Run the test to verify that it passes**

Run: `cd website && node --test --experimental-strip-types tests/path.test.ts`
Expected: `# pass 3`.

- [ ] **Step 5: Write the failing build check `website/scripts/check-dist.mjs`**

```js
// Verifies the prerendered site. Runs at the end of `npm run build`.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const { PAGES, NOT_FOUND, pageUrl, escapeHtml } = await import(
  pathToFileURL(join(root, "dist-ssr/render.js")).href
);

const problems = [];
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

for (const page of PAGES) {
  const html = read(join(dist, page.path, "index.html"));
  if (html === null) {
    problems.push(`${page.path}: no index.html in dist`);
    continue;
  }
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  if (h1s.length !== 1) problems.push(`${page.path}: expected 1 prerendered <h1>, found ${h1s.length}`);
  if (!html.includes(`<title>${escapeHtml(page.title)}</title>`)) problems.push(`${page.path}: wrong <title>`);
  if (!html.includes(`<link rel="canonical" href="${pageUrl(page.path)}" />`)) problems.push(`${page.path}: no canonical`);
  if (html.includes("<!--app-->") || html.includes("<!--head-->")) problems.push(`${page.path}: template placeholder left`);
  if (!html.includes("kelp-theme")) problems.push(`${page.path}: no early theme script`);
  if (!html.includes('rel="preload"')) problems.push(`${page.path}: no font preload`);
  if (/Bucket Browser|OWNER/.test(html)) problems.push(`${page.path}: old name or OWNER placeholder`);
  if (html.includes('class="theme-switch"') && !/value="system" checked=""/.test(html)) {
    problems.push(`${page.path}: theme switch must prerender with "system" checked (hydration)`);
  }
}

const home = read(join(dist, "index.html")) ?? "";
if (!home.includes('"@type":"SoftwareApplication"')) problems.push("/: no SoftwareApplication JSON-LD");

const notFound = read(join(dist, "404.html")) ?? "";
if (!notFound.includes('name="robots" content="noindex"')) problems.push("404.html: missing or not noindex");
if (!notFound.includes("drifted off")) problems.push("404.html: missing its message");

const sitemap = read(join(dist, "sitemap.xml")) ?? "";
for (const page of PAGES) {
  if (!sitemap.includes(`<loc>${pageUrl(page.path)}</loc>`)) problems.push(`sitemap: missing ${page.path}`);
}
if (sitemap.includes(NOT_FOUND.path)) problems.push("sitemap: must not list the 404 page");
if (!(read(join(dist, "robots.txt")) ?? "").includes("Sitemap:")) problems.push("robots.txt: missing or no Sitemap line");
if (!existsSync(join(dist, "og.png"))) problems.push("og.png: missing from dist (Task 11)");

if (problems.length) {
  console.error(`check-dist found ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-dist: ${PAGES.length} pages, 404, sitemap and robots look right`);
```

The `og.png` check fails until Task 11, and the font preload check fails until Task 7. That's expected.

- [ ] **Step 6: Rewrite `website/src/config.ts`**

```ts
// One place to edit names, URLs, the version and the page list.
export const SITE = {
  name: "Kelp",
  domain: "kelp.ozanai.dev", // placeholder until SPEC.md open question 2 is settled
  url: "https://kelp.ozanai.dev",
  version: "0.1.0",
  // Flip to true once the first .dmg is attached to a published GitHub Release.
  released: false,
  repoUrl: "https://github.com/Ozan797/Kelp",
  minMacOS: "macOS 13",
} as const;

// Tauri names the file {productName}_{version}_{arch}.dmg. Check this against the first real release.
export const DOWNLOAD_URL = `${SITE.repoUrl}/releases/download/v${SITE.version}/${SITE.name}_${SITE.version}_aarch64.dmg`;

export type PageMeta = { path: string; title: string; description: string };

// Every prerendered page. Titles must not contain & < or ".
export const PAGES = [
  {
    path: "/",
    title: "Kelp – a fast Mac app for S3, R2 and Hetzner",
    description:
      "Browse and transfer files across Amazon S3, Cloudflare R2 and Hetzner Object Storage from one fast Mac app.",
  },
] as const satisfies readonly PageMeta[];

export type PagePath = (typeof PAGES)[number]["path"];

export const NOT_FOUND: PageMeta = {
  path: "/404",
  title: "Page not found – Kelp",
  description: "This page doesn't exist.",
};

/** Link target for an internal page. Cloudflare Pages serves folders with a trailing slash. */
export const hrefFor = (path: string) => (path === "/" ? "/" : `${path}/`);

/** Absolute URL for canonical links and the sitemap. */
export const pageUrl = (path: string) => `${SITE.url}${hrefFor(path)}`;
```

- [ ] **Step 7: Write `website/src/head.ts`**

```ts
import { NOT_FOUND, PAGES, SITE, pageUrl, type PageMeta } from "./config";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function softwareJsonLd(): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    operatingSystem: `${SITE.minMacOS}+`,
    applicationCategory: "DeveloperApplication",
    softwareVersion: SITE.version,
    url: pageUrl("/"),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  // Escape "<" so the JSON can never close the <script> tag.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** The <head> tags for one page, injected by scripts/prerender.mjs. */
export function headFor(path: string): string {
  const page: PageMeta = PAGES.find((p) => p.path === path) ?? NOT_FOUND;
  const isNotFound = page === NOT_FOUND;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);

  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    isNotFound ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${pageUrl(page.path)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE.name}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${SITE.url}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  if (!isNotFound) tags.push(`<meta property="og:url" content="${pageUrl(page.path)}" />`);
  if (page.path === "/") tags.push(`<script type="application/ld+json">${softwareJsonLd()}</script>`);
  return tags.join("\n    ");
}
```

- [ ] **Step 8: Write `website/src/pages/NotFound.tsx` (simple version)**

```tsx
export default function NotFound() {
  return (
    <main id="main">
      <h1>This page drifted off.</h1>
      <p>The link may be old, or the page may have moved.</p>
      <p>
        <a href="/">Go to the home page</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 9: Write `website/src/routes.tsx`**

```tsx
import type { ComponentType } from "react";
import type { PagePath } from "./config";
import { normalizePath } from "./path";
import App from "./App";
import NotFound from "./pages/NotFound";

// Every entry in PAGES needs a component here. TypeScript reports a missing or extra key.
const ROUTES: Record<PagePath, ComponentType> = {
  "/": App,
};

export function pageFor(path: string): ComponentType {
  return (ROUTES as Record<string, ComponentType | undefined>)[normalizePath(path)] ?? NotFound;
}
```

- [ ] **Step 10: Write `website/src/render.tsx` (server entry)**

```tsx
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { headFor } from "./head";
import { pageFor } from "./routes";

export { NOT_FOUND, PAGES, SITE, pageUrl } from "./config";
export { escapeHtml } from "./head";

/** Renders one page to HTML for scripts/prerender.mjs. */
export function render(path: string): { html: string; head: string } {
  const Page = pageFor(path);
  const html = renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
  return { html, head: headFor(path) };
}
```

- [ ] **Step 11: Rewrite `website/src/main.tsx` (browser entry)**

```tsx
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { pageFor } from "./routes";
import "./styles.css";

const Page = pageFor(window.location.pathname);
const app = (
  <StrictMode>
    <Page />
  </StrictMode>
);

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

// In dev the HTML is empty, so render. In production it was prerendered, so hydrate:
// React reuses the existing HTML and only attaches event handlers.
if (import.meta.env.DEV) createRoot(container).render(app);
else hydrateRoot(container, app);
```

- [ ] **Step 12: Update `App.tsx` to use `DOWNLOAD_URL`**

In `website/src/App.tsx`, change the import line `import { SITE } from "./config";` to `import { DOWNLOAD_URL, SITE } from "./config";`, and change `href={SITE.downloadUrl}` to `href={DOWNLOAD_URL}`. Nothing else changes, because the page is replaced in Task 8.

- [ ] **Step 13: Rewrite `website/index.html` as the template**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f5f2ea" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#08111a" media="(prefers-color-scheme: dark)" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script>
      // Apply a saved theme before the first paint (same key as design/theme.ts).
      try {
        var t = localStorage.getItem("kelp-theme");
        if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
      } catch (e) {}
    </script>
    <!--head-->
  </head>
  <body>
    <div id="root"><!--app--></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 14: Update `website/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allow importing ../design (shared tokens, fonts, theme.ts) during development.
  server: { fs: { allow: [".."] } },
});
```

- [ ] **Step 15: Write `website/scripts/prerender.mjs`**

```js
// Renders every page to static HTML after `vite build`, then writes sitemap.xml and robots.txt.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const { render, PAGES, NOT_FOUND, pageUrl } = await import(
  pathToFileURL(join(root, "dist-ssr/render.js")).href
);

const template = readFileSync(join(dist, "index.html"), "utf8");

// Preload the two fonts that every page uses above the fold.
const preload = readdirSync(join(dist, "assets"))
  .filter((f) => /^(bricolage|hanken).*\.woff2$/.test(f))
  .map((f) => `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin />`)
  .join("\n    ");

function write(file, path) {
  const { html, head } = render(path);
  // Function replacers, so "$&" or "$1" inside page content are never treated as patterns.
  const out = template
    .replace("<!--head-->", () => `${head}\n    ${preload}`)
    .replace("<!--app-->", () => html);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
}

for (const page of PAGES) write(join(dist, page.path, "index.html"), page.path);
write(join(dist, "404.html"), NOT_FOUND.path);

const urls = PAGES.map((p) => `  <url><loc>${pageUrl(p.path)}</loc></url>`).join("\n");
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${pageUrl("/")}sitemap.xml\n`);

console.log(`prerender: wrote ${PAGES.length} pages, 404.html, sitemap.xml and robots.txt`);
```

- [ ] **Step 16: Update the scripts in `website/package.json` and `.gitignore`**

Replace the `"scripts"` block:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build && vite build --ssr src/render.tsx --outDir dist-ssr && node scripts/prerender.mjs && node scripts/check-dist.mjs",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "node --test --experimental-strip-types tests/path.test.ts ../design/theme.test.ts && node ../design/check-contrast.mjs"
  },
```
Add `dist-ssr/` under `# builds` in the root `.gitignore`.

- [ ] **Step 17: Run the tests and the build**

Run: `cd website && npm install && npm test && npm run build`
Expected:
- `npm test` passes.
- The build prints `prerender: wrote 1 pages, ...`, then `check-dist` fails with **exactly two** problems: `/: no font preload` (the fonts arrive with `site.css` in Task 7) and `og.png: missing from dist (Task 11)`. Any other problem is a bug in this task.
- `grep -c "Every bucket" dist/index.html` prints `1`, which proves the content is prerendered.

- [ ] **Step 18: Check dev mode**

Run `cd website && npm run dev`, then open `http://localhost:5173/` and `http://localhost:5173/nope`. Expected: the landing page, and "This page drifted off.". The browser console has no hydration errors.

- [ ] **Step 19: Commit**

```bash
git add .gitignore website
git commit -m "Prerender the website with per-page meta, sitemap and robots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Site shell (layout CSS, header, footer, theme switch, 404)

**Files:**
- Create: `website/src/site.css`
- Delete: `website/src/styles.css`
- Modify: `website/src/main.tsx` (`import "./site.css";`)
- Create: `website/src/components/Logo.tsx`, `Header.tsx`, `Footer.tsx`, `ThemeSwitch.tsx`, `DownloadButton.tsx`, `Bubbles.tsx`
- Modify: `website/src/pages/NotFound.tsx` (final version)
- Modify: `website/src/App.tsx` (import `DownloadButton` from components; delete its local copy)
- Modify: `website/public/favicon.svg`

**Interfaces:**
- Consumes: `SITE`, `DOWNLOAD_URL` and `hrefFor` from `config.ts`; `getThemePreference`, `setThemePreference` and `ThemePreference` from `../../design/theme`.
- Produces:
  - `<Header />`: a `.site-header` on navy with a skip link. Every page puts `<main id="main">` after it.
  - `<Footer />`
  - `<ThemeSwitch />`
  - `<DownloadButton large? />`
  - `<Bubbles />`
  - `<Logo />`
- CSS layout classes:
  - `.container`
  - `.band` (navy gradient section; add `.theme-dark`)
  - `.section`, `.section-intro`
  - `.hero`, `.hero-copy`, `.lede`, `.hero-actions`, `.hero-note`, `.hero-demo`, `.demo-hint`
  - `.providers`, `.feature-grid`, `.security`, `.download-grid`, `.download-meta`
  - `.band-title`, `.prose`, `.article`, `.docs`, `.docs-nav`
  - `.release`, `.release-head`
  - `.not-found`, `.not-found-body`
  - The demo window classes

- [ ] **Step 1: Write `website/src/site.css`**

```css
/* Kelp website layout. Tokens and shared components come from design/. Semantic tokens only. */
@import "../../design/fonts/fonts.css";
@import "../../design/tokens.css";
@import "../../design/components.css";

:root {
  --gutter: clamp(20px, 5vw, 64px);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 400 1.0625rem / 1.6 var(--font-body);
  -webkit-font-smoothing: antialiased;
}

h1,
h2,
h3 {
  margin: 0;
  font-family: var(--font-display);
  line-height: 1.05;
  letter-spacing: -0.02em;
}

a {
  color: var(--link);
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding-inline: var(--gutter);
}

/* ---------- header ---------- */

.skip-link {
  position: absolute;
  top: -100px;
  left: var(--space-4);
  z-index: 10;
}

.skip-link:focus {
  top: var(--space-4);
}

.site-header {
  background: var(--band-top);
  border-bottom: 1px solid var(--border);
}

/* A band right below the header covers its edge, so header and band read as one surface. */
.site-header + main > .band:first-child,
.site-header + main.band {
  margin-top: -1px;
}

.site-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding-block: var(--space-4);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text);
  font: 700 var(--text-lg) / 1 var(--font-display);
  text-decoration: none;
}

.logo {
  width: 28px;
  height: 28px;
}

.logo .mark-bg {
  fill: var(--accent);
}

.logo .mark-bucket {
  fill: var(--on-accent);
}

.logo .mark-rim {
  fill: var(--accent-soft);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.header-nav {
  display: flex;
  gap: var(--space-4);
}

.header-nav a {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
}

.header-nav a:hover {
  color: var(--text);
}

@media (max-width: 640px) {
  .hide-sm {
    display: none;
  }

  .header-actions,
  .header-nav {
    gap: var(--space-3);
  }
}

@media (max-width: 420px) {
  .hide-xs {
    display: none;
  }
}

/* ---------- navy bands ---------- */

.band {
  position: relative;
  overflow: hidden;
  background: var(--hero-gradient);
  border-bottom: 1px solid var(--border);
}

.band > :not(.bubbles) {
  position: relative;
  z-index: 1;
}

/* ---------- landing ---------- */

.hero-copy {
  padding-top: var(--space-8);
  /* Room for the demo window to overlap. No text may sit in this area (contrast). */
  padding-bottom: 280px;
  text-align: center;
}

.hero h1 {
  font-size: var(--text-display);
  font-weight: 800;
}

.lede {
  max-width: 38ch;
  margin: var(--space-5) auto 0;
  color: var(--text-muted);
  font-size: var(--text-lg);
}

.hero-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

.hero-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.hero-demo {
  position: relative;
  z-index: 2;
  max-width: 1000px;
  margin: -220px auto 0;
  padding-inline: var(--gutter);
}

.demo-hint {
  margin: var(--space-3) 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.section {
  padding-block: var(--space-9);
}

.section h2 {
  font-size: var(--text-3xl);
}

.section-intro {
  max-width: 60ch;
  margin: var(--space-3) 0 0;
  color: var(--text-muted);
}

.providers {
  padding-top: var(--space-8);
  text-align: center;
}

.providers p {
  margin: 0 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.providers ul {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
  margin: var(--space-6) 0 0;
  padding: 0;
  list-style: none;
}

.feature-grid h3 {
  margin-bottom: var(--space-2);
  font-size: var(--text-lg);
}

.feature-grid p {
  margin: 0;
  color: var(--text-muted);
}

.security {
  background: var(--surface);
}

.security .container {
  display: grid;
  gap: var(--space-3);
  padding-block: var(--space-8);
}

.security h2 {
  font-size: var(--text-2xl);
}

.security p {
  max-width: 60ch;
  margin: 0;
  color: var(--text-muted);
}

.download-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-7);
  align-items: start;
}

.download-meta {
  margin: var(--space-3) 0 var(--space-5);
  color: var(--text-muted);
}

/* ---------- footer ---------- */

.site-footer {
  border-top: 1px solid var(--border);
}

.site-footer .container {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-4);
  padding-block: var(--space-6);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.site-footer nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}

.site-footer a {
  color: var(--text-muted);
  text-decoration: none;
}

.site-footer a:hover {
  color: var(--text);
}

/* ---------- articles and docs ---------- */

.band-title {
  padding-block: var(--space-6) var(--space-8);
}

.band-title h1 {
  font-size: var(--text-3xl);
}

.band-title p {
  max-width: 60ch;
  margin: var(--space-3) 0 0;
  color: var(--text-muted);
}

.article {
  padding-block: var(--space-8);
}

.prose {
  max-width: 68ch;
}

.prose h1 {
  margin-bottom: var(--space-4);
  font-size: var(--text-2xl);
}

.prose h2 {
  margin: var(--space-7) 0 var(--space-3);
  font-size: var(--text-xl);
}

.prose p,
.prose ul,
.prose table,
.prose pre,
.prose .steps,
.prose .callout {
  margin: 0 0 var(--space-4);
}

.prose table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.prose th,
.prose td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.prose th {
  color: var(--text-muted);
  font-weight: 600;
}

.docs {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--space-7);
  padding-block: var(--space-8);
}

.docs-nav {
  position: sticky;
  top: var(--space-5);
  align-self: start;
}

@media (max-width: 768px) {
  .docs {
    grid-template-columns: 1fr;
    gap: var(--space-5);
  }

  .docs-nav {
    position: static;
    overflow-x: auto;
  }

  .docs-nav .nav-list {
    display: flex;
    gap: var(--space-1);
  }

  .docs-nav .nav-list a {
    white-space: nowrap;
  }
}

.release + .release {
  margin-top: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border);
}

.release-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.release-head h2 {
  margin: 0;
}

.release-head p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* ---------- 404 ---------- */

.not-found {
  min-height: 80vh;
  display: grid;
}

.not-found-body {
  display: grid;
  place-content: center;
  gap: var(--space-4);
  padding-block: var(--space-9);
  text-align: center;
}

.not-found h1 {
  font-size: var(--text-display);
}

.not-found p {
  margin: 0;
  color: var(--text-muted);
}

/* ---------- demo window (follows the page theme) ---------- */

.window {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font: 400 13px / 1.4 var(--font-ui);
  text-align: left;
}

.titlebar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.lights {
  position: absolute;
  left: var(--space-4);
  display: flex;
  gap: var(--space-2);
}

.lights i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--border);
}

.title {
  color: var(--text-muted);
  font-weight: 600;
}

.window-body {
  display: grid;
  grid-template-columns: 190px 1fr;
  min-height: 340px;
}

.sidebar {
  padding: var(--space-3) var(--space-2);
  border-right: 1px solid var(--border);
  background: var(--surface);
}

.side-label {
  margin: var(--space-1) var(--space-2) var(--space-2);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.side-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 6px var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.side-item:hover {
  background: var(--bg);
}

.side-item.active {
  background: var(--accent-soft);
  color: var(--on-accent-soft);
  font-weight: 600;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot.s3 {
  background: var(--provider-s3);
}

.dot.r2 {
  background: var(--provider-r2);
}

.dot.hetzner {
  background: var(--provider-hetzner);
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
}

.back {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--text);
  cursor: pointer;
}

.back:hover:not(:disabled) {
  background: var(--surface);
}

.back:disabled {
  opacity: 0.4;
  cursor: default;
}

.back svg {
  width: 16px;
  height: 16px;
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.crumbs li + li::before {
  content: "/";
  margin: 0 4px;
  color: var(--text-muted);
}

.crumbs button {
  padding: 2px 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}

.crumbs li:last-child button {
  color: var(--text);
  font-weight: 600;
}

.list-head,
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 100px;
  gap: var(--space-3);
  padding-inline: var(--space-3);
}

.list-head {
  padding-block: 6px;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.list {
  flex: 1;
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
}

.row {
  align-items: center;
  width: 100%;
  min-height: 30px;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--surface);
}

.row.selected {
  background: var(--accent);
  color: var(--on-accent);
}

.cell {
  overflow: hidden;
  color: var(--text-muted);
  font: 400 12px / 1.4 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell.name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: inherit;
  font: inherit;
}

.row.selected .cell {
  color: inherit;
}

.row-icon {
  flex: none;
  width: 16px;
  height: 16px;
}

.row-icon.folder {
  color: var(--accent);
}

.row-icon.file {
  color: var(--text-muted);
}

.row.selected .row-icon {
  color: inherit;
}

.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 6px var(--space-3);
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
}

.transfer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.bar {
  width: 100px;
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--border);
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  animation: demo-progress 6s var(--ease-out) infinite;
}

@keyframes demo-progress {
  from {
    transform: scaleX(0.1);
  }
  to {
    transform: scaleX(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bar-fill {
    animation: none;
    transform: scaleX(0.62);
  }
}

@media (max-width: 640px) {
  .window-body {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .side-label {
    display: none;
  }

  .side-item {
    width: auto;
    white-space: nowrap;
  }

  .list-head,
  .row {
    grid-template-columns: minmax(0, 1fr) 70px;
  }

  .list-head span:last-child,
  .row .cell:last-child {
    display: none;
  }
}
```

- [ ] **Step 2: Write `website/src/components/Logo.tsx`**

```tsx
/** Kelp mark. Colours come from CSS (.logo .mark-*), so it follows the theme. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect className="mark-bg" width="64" height="64" rx="15" />
      <path className="mark-bucket" d="M16 22h32l-4 26a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3z" />
      <ellipse className="mark-rim" cx="32" cy="22" rx="16" ry="5" />
    </svg>
  );
}
```

- [ ] **Step 3: Write `website/src/components/ThemeSwitch.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { getThemePreference, setThemePreference, type ThemePreference } from "../../../design/theme";

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {children}
  </svg>
);

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: "system",
    label: "System",
    icon: icon(
      <>
        <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
        <path d="M5.5 14h5M8 11.5V14" />
      </>,
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: icon(
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
      </>,
    ),
  },
  { value: "dark", label: "Dark", icon: icon(<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />) },
];

export function ThemeSwitch() {
  // Start as "system" so the prerendered HTML and the first client render match.
  // The saved choice is read after hydration. The <head> script has already applied it visually.
  const [pref, setPref] = useState<ThemePreference>("system");
  useEffect(() => setPref(getThemePreference()), []);

  return (
    <fieldset className="theme-switch">
      <legend className="visually-hidden">Theme</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} title={option.label}>
          <input
            className="visually-hidden"
            type="radio"
            name="theme"
            value={option.value}
            checked={pref === option.value}
            onChange={() => {
              setThemePreference(option.value);
              setPref(option.value);
            }}
          />
          {option.icon}
          <span className="visually-hidden">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
```

- [ ] **Step 4: Write `website/src/components/DownloadButton.tsx`**

```tsx
import { DOWNLOAD_URL, SITE } from "../config";

export function DownloadButton({ large = false }: { large?: boolean }) {
  const size = large ? " button-lg" : "";
  if (!SITE.released) {
    return (
      <span className={`button button-secondary${size}`} aria-disabled="true">
        Download coming soon
      </span>
    );
  }
  return (
    <a className={`button button-primary${size}`} href={DOWNLOAD_URL}>
      Download for Mac
    </a>
  );
}
```

- [ ] **Step 5: Write `website/src/components/Bubbles.tsx`**

```tsx
import type { CSSProperties } from "react";

// Position, size, rise duration and start offset for each bubble. Kept sparse so text stays readable.
const BUBBLES = [
  { x: "8%", size: "6px", d: "9s", delay: "0s" },
  { x: "18%", size: "4px", d: "7s", delay: "-3s" },
  { x: "31%", size: "6px", d: "11s", delay: "-6s" },
  { x: "61%", size: "3px", d: "6s", delay: "-1s" },
  { x: "72%", size: "8px", d: "9s", delay: "-2s" },
  { x: "83%", size: "4px", d: "8s", delay: "-5s" },
  { x: "92%", size: "6px", d: "12s", delay: "-8s" },
];

/** Ambient bubbles for a navy band. Hidden when the user prefers reduced motion. */
export function Bubbles() {
  return (
    <div className="bubbles" aria-hidden="true">
      {BUBBLES.map((b) => (
        <span
          key={b.x}
          style={{ "--x": b.x, "--size": b.size, "--d": b.d, "--delay": b.delay } as CSSProperties}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Write `website/src/components/Header.tsx`**

```tsx
import { SITE, hrefFor } from "../config";
import { Logo } from "./Logo";
import { ThemeSwitch } from "./ThemeSwitch";

/** Navy site header. Every page renders <main id="main"> right after it. */
export function Header() {
  return (
    <header className="site-header theme-dark">
      <a className="skip-link button button-primary" href="#main">
        Skip to content
      </a>
      <div className="container site-header-inner">
        <a className="brand" href="/">
          <Logo />
          {SITE.name}
        </a>
        <div className="header-actions">
          <nav className="header-nav" aria-label="Main">
            <a href={hrefFor("/docs")}>Docs</a>
            <a href={hrefFor("/changelog")}>Changelog</a>
            <a className="hide-xs" href={SITE.repoUrl}>
              GitHub
            </a>
          </nav>
          <ThemeSwitch />
          <a className="button button-primary hide-sm" href="/#download">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}
```

The `/docs` and `/changelog` links return 404 until Tasks 9 and 10. That's expected.

- [ ] **Step 7: Write `website/src/components/Footer.tsx`**

```tsx
import { SITE, hrefFor } from "../config";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>{SITE.domain}</span>
        <nav aria-label="Footer">
          <a href={hrefFor("/docs")}>Docs</a>
          <a href={hrefFor("/changelog")}>Changelog</a>
          <a href={hrefFor("/privacy")}>Privacy</a>
          <a href={SITE.repoUrl}>Source on GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 8: Rewrite `website/src/pages/NotFound.tsx` (final version)**

```tsx
import { Bubbles } from "../components/Bubbles";
import { Header } from "../components/Header";

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main" className="band theme-dark not-found">
        <Bubbles />
        <div className="container not-found-body">
          <h1>This page drifted off.</h1>
          <p>The link may be old, or the page may have moved.</p>
          <p>
            <a className="button button-primary button-lg" href="/">
              Go to the home page
            </a>
          </p>
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 9: Switch the CSS and the favicon, and stop `App.tsx` defining its own button**

- In `website/src/main.tsx`, change `import "./styles.css";` to `import "./site.css";`. Then run `git rm website/src/styles.css`.
- In `website/src/App.tsx`, delete the local `function DownloadButton ... }` and add `import { DownloadButton } from "./components/DownloadButton";`. Remove `DOWNLOAD_URL` from the config import if it's no longer used, because `noUnusedLocals` is on.
- Replace `website/public/favicon.svg` with:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#14806f"/>
  <path d="M16 22h32l-4 26a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3z" fill="#ffffff"/>
  <ellipse cx="32" cy="22" rx="16" ry="5" fill="#d9efe9"/>
</svg>
```

- [ ] **Step 10: Build and check**

Run: `cd website && npm test && npm run build`
Expected: `check-dist` reports only `og.png: missing from dist (Task 11)`. The theme switch rule passes, because the 404 page renders the switch with `value="system" checked=""`.

Then run `grep -rnE '#[0-9a-fA-F]{3,8}\b' src`. Expected: matches only in `src/App.tsx` (the old logo), which is deleted in Task 8.

- [ ] **Step 11: Look at the 404 page in both themes**

```bash
cd website && npx vite preview --port 4173 >/dev/null 2>&1 &
PREVIEW=$!; sleep 2
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=2000 --window-size=1280,900 --screenshot="$TMPDIR/kelp-404.png" http://localhost:4173/nope
"$CHROME" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=2000 --window-size=375,900 --screenshot="$TMPDIR/kelp-404-375.png" http://localhost:4173/nope
kill $PREVIEW
```
Read both PNGs. Expected:
- A navy header with the Kelp wordmark, Docs, Changelog, the theme switch and Download.
- The heading in Bricolage, and a teal button.
- At 375px the header fits on one row. GitHub and Download are hidden.

- [ ] **Step 12: Commit**

```bash
git add -A website
git commit -m "Add website shell: tokens, header, footer, theme switch, 404

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Landing page

**Files:**
- Create: `website/src/pages/Landing.tsx`
- Create: `website/src/content/install.tsx`
- Modify: `website/src/routes.tsx` (`"/": Landing`)
- Delete: `website/src/App.tsx`
- Keep unchanged: `website/src/components/DemoWindow.tsx`, `website/src/data.ts` (styled by `site.css`)

**Interfaces:**
- Consumes: `Header`, `Footer`, `Bubbles`, `DownloadButton`, `DemoWindow`, `SITE` and `hrefFor`.
- Produces: `<InstallSteps />` from `content/install.tsx`. The Getting started page reuses it in Task 9.

- [ ] **Step 1: Write `website/src/content/install.tsx`**

```tsx
/** Install steps, shared by the landing page and the Getting started docs page. */
export function InstallSteps() {
  return (
    <ol className="steps" role="list">
      <li>
        <span>
          Download the <code>.dmg</code> file.
        </span>
      </li>
      <li>
        <span>Open it and drag Kelp into your Applications folder.</span>
      </li>
      {/* Remove this step once the app is notarised (SPEC.md milestone M5). */}
      <li>
        <span>
          Open Kelp. If macOS says it can't check the app, open{" "}
          <strong>System Settings → Privacy &amp; Security</strong> and choose <strong>Open Anyway</strong>.
        </span>
      </li>
    </ol>
  );
}
```

- [ ] **Step 2: Write `website/src/pages/Landing.tsx`**

```tsx
import { Bubbles } from "../components/Bubbles";
import DemoWindow from "../components/DemoWindow";
import { DownloadButton } from "../components/DownloadButton";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { SITE, hrefFor } from "../config";
import { InstallSteps } from "../content/install";

// Copy must match SPEC.md. No file search (it's "Later"), and no claim that files copy between providers without a download.
const FEATURES = [
  {
    title: "Three providers, one sidebar",
    body: "Connect Amazon S3, Cloudflare R2 and Hetzner Object Storage once. Switch between them without logging in again or opening another tool.",
  },
  {
    title: "Transfers that survive bad Wi-Fi",
    body: "Large files upload and download in parallel pieces. Pause, resume, and let failed pieces retry on their own.",
  },
  {
    title: "Keyboard first",
    body: "Press ⌘K to jump to any bucket or folder, or run a command without reaching for the mouse.",
  },
  {
    title: "Drag and drop",
    body: "Drop files or whole folders onto the window to upload them. Drag between two connections to copy from one provider to another.",
  },
  {
    title: "Folders that behave like folders",
    body: "Create, rename and delete folders. Before a big move or delete, Kelp tells you how many files it will touch.",
  },
  {
    title: "Quick previews",
    body: "Look at images, text and video right in the app, without saving them to your Mac first.",
  },
];

const PROVIDERS = ["Amazon S3", "Cloudflare R2", "Hetzner Object Storage"];

export default function Landing() {
  return (
    <>
      <Header />
      <main id="main">
        <section className="band theme-dark hero" aria-labelledby="hero-title">
          <Bubbles />
          <div className="container hero-copy">
            <h1 id="hero-title">Every bucket, one window.</h1>
            <p className="lede">
              A fast Mac app for browsing and moving files across Amazon S3, Cloudflare R2 and Hetzner Object
              Storage.
            </p>
            <div className="hero-actions">
              <DownloadButton large />
              <p className="hero-note">For Apple Silicon Macs, {SITE.minMacOS} or later.</p>
            </div>
          </div>
        </section>

        <div className="hero-demo">
          <DemoWindow />
          <p className="demo-hint">This is a live preview with sample files. Click a folder to open it.</p>
        </div>

        <section className="container providers" aria-label="Supported providers">
          <p>Works with</p>
          <ul role="list">
            {PROVIDERS.map((name) => (
              <li key={name} className="badge">
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section className="container section" id="features" aria-labelledby="features-title">
          <h2 id="features-title">What Kelp does</h2>
          <ul className="feature-grid" role="list">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="card">
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="band theme-dark security" aria-labelledby="security-title">
          <div className="container">
            <h2 id="security-title">Your keys stay in the macOS Keychain</h2>
            <p>
              Kelp saves your secret access keys in the Keychain, the same place macOS keeps your passwords. They
              never go into a settings file or a log, or anywhere except your storage provider.
            </p>
            <p>
              <a href={hrefFor("/privacy")}>Read how Kelp handles your data</a>
            </p>
          </div>
        </section>

        <section className="container section" id="download" aria-labelledby="download-title">
          <div className="download-grid">
            <div>
              <h2 id="download-title">Get {SITE.name}</h2>
              <p className="download-meta">
                Version {SITE.version} for Apple Silicon, {SITE.minMacOS} or later.
              </p>
              <DownloadButton large />
            </div>
            <InstallSteps />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Point the route at the new page and delete `App.tsx`**

In `website/src/routes.tsx`, replace `import App from "./App";` with `import Landing from "./pages/Landing";` and `"/": App,` with `"/": Landing,`. Then run `git rm website/src/App.tsx`.

- [ ] **Step 4: Build and run the checks**

Run: `cd website && npm run build; grep -rnE '#[0-9a-fA-F]{3,8}\b' src`
Expected:
- `check-dist` reports only the `og.png` problem.
- The grep prints nothing.
- `grep -c "What Kelp does" dist/index.html` prints `1`.

- [ ] **Step 5: Screenshot the landing page at three widths and in dark mode**

```bash
cd website && npx vite preview --port 4173 >/dev/null 2>&1 &
PREVIEW=$!; sleep 2
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for w in 375 768 1280; do
  "$CHROME" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=2000 --window-size=$w,3600 --screenshot="$TMPDIR/kelp-home-$w.png" http://localhost:4173/
done
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-dark-mode --virtual-time-budget=2000 --window-size=1280,3600 --screenshot="$TMPDIR/kelp-home-dark.png" http://localhost:4173/
kill $PREVIEW
```
Read all four PNGs. Expected:
- A navy hero with the headline and lede in the upper part.
- The demo window overlapping the bottom edge of the navy onto the page.
- Provider badges, six feature cards, a navy Keychain band, and the download section with steps.
- **The dark shot** has a navy page, a navy-800 demo window, and visible edges between the bands.
- **The 375px shot** has no horizontal scroll, and the demo sidebar becomes a horizontal row.

If the dark shot is still light, `--force-dark-mode` didn't apply. Note that in the report and check it manually in Task 13.

- [ ] **Step 6: Commit**

```bash
git add -A website
git commit -m "Rebuild the landing page on the Kelp design system

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs pages

**Files:**
- Modify: `website/src/config.ts` (5 `PAGES` entries)
- Modify: `website/src/routes.tsx` (5 routes)
- Create: `website/src/components/DocsLayout.tsx`
- Create: `website/src/content/docs-shared.tsx`
- Create: `website/src/pages/docs/GettingStarted.tsx`, `S3.tsx`, `R2.tsx`, `Hetzner.tsx`, `Troubleshooting.tsx`

**Interfaces:**
- Consumes: `Header`, `Footer`, `hrefFor`, `SITE`, and `InstallSteps` (Task 8).
- Produces:
  - `DocsLayout({ path, title, children })`, where `path` is one of the docs paths
  - `KeychainCallout()`
  - `AddConnectionSteps({ provider })`
  - `SettingsTable({ rows })`, where `rows` is `[label: string, value: ReactNode][]`

- [ ] **Step 1: Add the pages to `PAGES` in `config.ts`, after the `"/"` entry**

```ts
  {
    path: "/docs",
    title: "Getting started – Kelp docs",
    description: "Install Kelp and connect your first Amazon S3, Cloudflare R2 or Hetzner bucket.",
  },
  {
    path: "/docs/s3",
    title: "Connect Amazon S3 – Kelp docs",
    description: "Create an AWS access key and connect Amazon S3 to Kelp.",
  },
  {
    path: "/docs/r2",
    title: "Connect Cloudflare R2 – Kelp docs",
    description: "Create an R2 API token and connect Cloudflare R2 to Kelp.",
  },
  {
    path: "/docs/hetzner",
    title: "Connect Hetzner Object Storage – Kelp docs",
    description: "Generate S3 credentials and connect Hetzner Object Storage to Kelp.",
  },
  {
    path: "/docs/troubleshooting",
    title: "Troubleshooting – Kelp docs",
    description: "Fix common connection errors in Kelp.",
  },
```

- [ ] **Step 2: Run the build to verify that it fails**

Run: `cd website && npx tsc -b`
Expected: an error in `routes.tsx` saying that properties `"/docs"`, `"/docs/s3"`, … are missing. This is the guard that keeps `PAGES` and `ROUTES` in sync.

- [ ] **Step 3: Write `website/src/components/DocsLayout.tsx`**

```tsx
import type { ReactNode } from "react";
import { hrefFor } from "../config";
import { Footer } from "./Footer";
import { Header } from "./Header";

const DOCS_NAV = [
  { path: "/docs", label: "Getting started" },
  { path: "/docs/s3", label: "Amazon S3" },
  { path: "/docs/r2", label: "Cloudflare R2" },
  { path: "/docs/hetzner", label: "Hetzner" },
  { path: "/docs/troubleshooting", label: "Troubleshooting" },
] as const;

type DocsPath = (typeof DOCS_NAV)[number]["path"];

export function DocsLayout({ path, title, children }: { path: DocsPath; title: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="container docs">
        <nav className="docs-nav" aria-label="Docs">
          <ul className="nav-list" role="list">
            {DOCS_NAV.map((item) => (
              <li key={item.path}>
                <a href={hrefFor(item.path)} aria-current={item.path === path ? "page" : undefined}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose">
          <h1>{title}</h1>
          {children}
        </article>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 4: Write `website/src/content/docs-shared.tsx`**

```tsx
import type { ReactNode } from "react";

export function KeychainCallout() {
  return (
    <p className="callout callout-info">
      Kelp saves your secret access key in the macOS Keychain. It's never written to a settings file or a log.
    </p>
  );
}

export function AddConnectionSteps({ provider }: { provider: string }) {
  return (
    <ol className="steps" role="list">
      <li>
        <span>
          In Kelp, choose <strong>Add connection</strong> and pick <strong>{provider}</strong>.
        </span>
      </li>
      <li>
        <span>Enter a name you'll recognise, then paste your access key ID and secret access key.</span>
      </li>
      <li>
        <span>Fill in the connection settings from the table above.</span>
      </li>
      <li>
        <span>
          Choose <strong>Test connection</strong>. When it succeeds, choose <strong>Save</strong>.
        </span>
      </li>
    </ol>
  );
}

export function SettingsTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Setting</th>
          <th scope="col">What to enter</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Write `website/src/pages/docs/GettingStarted.tsx`**

```tsx
import { DocsLayout } from "../../components/DocsLayout";
import { SITE, hrefFor } from "../../config";
import { KeychainCallout } from "../../content/docs-shared";
import { InstallSteps } from "../../content/install";

export default function GettingStarted() {
  return (
    <DocsLayout path="/docs" title="Getting started">
      <p>
        Kelp is a Mac app for browsing and moving files in Amazon S3, Cloudflare R2 and Hetzner Object Storage.
        This page gets you from download to your first bucket.
      </p>

      <h2>Install Kelp</h2>
      <InstallSteps />

      <h2>Add your first connection</h2>
      <ol className="steps" role="list">
        <li>
          <span>
            Get an access key from your provider. The guides for <a href={hrefFor("/docs/s3")}>Amazon S3</a>,{" "}
            <a href={hrefFor("/docs/r2")}>Cloudflare R2</a> and <a href={hrefFor("/docs/hetzner")}>Hetzner</a>{" "}
            show where to find one.
          </span>
        </li>
        <li>
          <span>
            In Kelp, choose <strong>Add connection</strong> and pick your provider.
          </span>
        </li>
        <li>
          <span>Paste your access key ID and secret access key, and fill in the settings from the guide.</span>
        </li>
        <li>
          <span>
            Choose <strong>Test connection</strong>. When it succeeds, choose <strong>Save</strong>.
          </span>
        </li>
      </ol>
      <KeychainCallout />

      <h2>Need help?</h2>
      <p>
        If a connection fails, the <a href={hrefFor("/docs/troubleshooting")}>troubleshooting guide</a> lists the
        common errors and how to fix them. You can also <a href={`${SITE.repoUrl}/issues`}>open an issue on GitHub</a>.
      </p>
    </DocsLayout>
  );
}
```

- [ ] **Step 6: Write `website/src/pages/docs/S3.tsx`**

```tsx
import { DocsLayout } from "../../components/DocsLayout";
import { AddConnectionSteps, KeychainCallout, SettingsTable } from "../../content/docs-shared";

export default function S3() {
  return (
    <DocsLayout path="/docs/s3" title="Connect Amazon S3">
      <p>
        To connect Amazon S3, Kelp needs an access key for an IAM user. Give that user access to only the buckets it
        needs.
      </p>

      <h2>Create an access key</h2>
      <ol className="steps" role="list">
        <li>
          <span>
            Sign in to the AWS console and open <strong>IAM → Users</strong>. Choose <strong>Create user</strong> and
            give it a name such as <code>kelp</code>.
          </span>
        </li>
        <li>
          <span>
            Attach a policy. <code>AmazonS3ReadOnlyAccess</code> is enough to browse and download. To upload and
            delete, use a policy that also allows <code>s3:PutObject</code> and <code>s3:DeleteObject</code> on your
            buckets.
          </span>
        </li>
        <li>
          <span>
            Open the new user, go to <strong>Security credentials</strong> and choose{" "}
            <strong>Create access key</strong>. Pick <strong>Application running outside AWS</strong> as the use
            case.
          </span>
        </li>
        <li>
          <span>Copy the access key ID and the secret access key. AWS shows the secret only once.</span>
        </li>
      </ol>

      <h2>Connection settings</h2>
      <SettingsTable
        rows={[
          [
            "Region",
            <>
              The region your buckets are in, for example <code>eu-west-2</code>. The S3 console shows it next to
              each bucket.
            </>,
          ],
          ["Endpoint", "Leave empty. Kelp uses the standard AWS endpoint for the region."],
          ["Path-style addressing", "Off."],
        ]}
      />

      <h2>Add it to Kelp</h2>
      <AddConnectionSteps provider="Amazon S3" />
      <KeychainCallout />
    </DocsLayout>
  );
}
```

- [ ] **Step 7: Write `website/src/pages/docs/R2.tsx`**

```tsx
import { DocsLayout } from "../../components/DocsLayout";
import { hrefFor } from "../../config";
import { AddConnectionSteps, KeychainCallout, SettingsTable } from "../../content/docs-shared";

export default function R2() {
  return (
    <DocsLayout path="/docs/r2" title="Connect Cloudflare R2">
      <p>
        Cloudflare R2 speaks the S3 API, so Kelp connects to it with the access key from an R2 API token.
      </p>

      <h2>Create an access key</h2>
      <ol className="steps" role="list">
        <li>
          <span>
            In the Cloudflare dashboard, open <strong>R2 Object Storage</strong>. Copy your{" "}
            <strong>Account ID</strong> from the overview page. You need it for the endpoint.
          </span>
        </li>
        <li>
          <span>
            Choose <strong>Manage API tokens</strong>, then <strong>Create API token</strong>.
          </span>
        </li>
        <li>
          <span>
            Give it the <strong>Object Read &amp; Write</strong> permission. If you limit it to specific buckets, see{" "}
            <a href={hrefFor("/docs/troubleshooting")}>No buckets are listed</a>.
          </span>
        </li>
        <li>
          <span>
            Create the token and copy the <strong>Access Key ID</strong> and <strong>Secret Access Key</strong>.
            Cloudflare shows the secret only once.
          </span>
        </li>
      </ol>

      <h2>Connection settings</h2>
      <SettingsTable
        rows={[
          [
            "Region",
            <>
              <code>auto</code>
            </>,
          ],
          [
            "Endpoint",
            <>
              <code>{"https://<ACCOUNT_ID>.r2.cloudflarestorage.com"}</code>, with your account ID in place of{" "}
              <code>{"<ACCOUNT_ID>"}</code>. For buckets in the EU jurisdiction, use{" "}
              <code>{"https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com"}</code>.
            </>,
          ],
          ["Path-style addressing", "Off."],
        ]}
      />

      <h2>Add it to Kelp</h2>
      <AddConnectionSteps provider="Cloudflare R2" />
      <KeychainCallout />
    </DocsLayout>
  );
}
```

- [ ] **Step 8: Write `website/src/pages/docs/Hetzner.tsx`**

```tsx
import { DocsLayout } from "../../components/DocsLayout";
import { AddConnectionSteps, KeychainCallout, SettingsTable } from "../../content/docs-shared";

export default function Hetzner() {
  return (
    <DocsLayout path="/docs/hetzner" title="Connect Hetzner Object Storage">
      <p>
        Hetzner Object Storage is S3-compatible. Kelp connects to it with S3 credentials from your Hetzner Cloud
        project.
      </p>

      <h2>Create an access key</h2>
      <ol className="steps" role="list">
        <li>
          <span>Open the Hetzner Console and select the project that holds your buckets.</span>
        </li>
        <li>
          <span>
            Go to <strong>Security → S3 credentials</strong> and choose <strong>Generate credentials</strong>.
          </span>
        </li>
        <li>
          <span>Copy the access key and the secret key. Hetzner shows the secret only once.</span>
        </li>
      </ol>

      <h2>Connection settings</h2>
      <SettingsTable
        rows={[
          [
            "Region",
            <>
              The location of your buckets: <code>fsn1</code> (Falkenstein), <code>nbg1</code> (Nuremberg) or{" "}
              <code>hel1</code> (Helsinki).
            </>,
          ],
          [
            "Endpoint",
            <>
              <code>{"https://<location>.your-objectstorage.com"}</code>, for example{" "}
              <code>https://fsn1.your-objectstorage.com</code>.
            </>,
          ],
          ["Path-style addressing", "Off."],
        ]}
      />

      <h2>Add it to Kelp</h2>
      <AddConnectionSteps provider="Hetzner" />
      <KeychainCallout />
    </DocsLayout>
  );
}
```

- [ ] **Step 9: Write `website/src/pages/docs/Troubleshooting.tsx`**

```tsx
import { DocsLayout } from "../../components/DocsLayout";
import { SITE } from "../../config";

export default function Troubleshooting() {
  return (
    <DocsLayout path="/docs/troubleshooting" title="Troubleshooting">
      <p>Most connection problems come from a mistyped value. Find the message Kelp shows below.</p>

      <h2>The signature doesn't match</h2>
      <p>
        The secret access key is wrong or incomplete. Copy it again from your provider and check that no spaces were
        added at either end. Also check that the region matches your bucket.
      </p>

      <h2>Access denied</h2>
      <p>
        The key works, but it isn't allowed to do this. Check the permissions or policy attached to the key in your
        provider's console.
      </p>

      <h2>No buckets are listed</h2>
      <p>
        Some keys can read objects but can't list buckets, for example Cloudflare R2 tokens limited to specific
        buckets. Give the key permission to list buckets, or create a new key with wider access.
      </p>

      <h2>Kelp can't reach the endpoint</h2>
      <p>
        Check the endpoint for typos and make sure it starts with <code>https://</code>. A company firewall or VPN may
        also block it. If the error mentions a host name that contains your bucket name, turn on path-style
        addressing for the connection.
      </p>

      <h2>The request time is too far off</h2>
      <p>
        Your Mac's clock is wrong. Open <strong>System Settings → General → Date &amp; Time</strong> and turn on{" "}
        <strong>Set time and date automatically</strong>.
      </p>

      <h2>macOS won't open Kelp</h2>
      <p>
        If macOS says it can't check the app, open <strong>System Settings → Privacy &amp; Security</strong> and
        choose <strong>Open Anyway</strong>.
      </p>

      <h2>Still stuck?</h2>
      <p>
        <a href={`${SITE.repoUrl}/issues`}>Open an issue on GitHub</a> and include the message Kelp shows. Never
        include your secret key.
      </p>
    </DocsLayout>
  );
}
```

- [ ] **Step 10: Add the routes**

In `website/src/routes.tsx`, add these imports:
```tsx
import GettingStarted from "./pages/docs/GettingStarted";
import Hetzner from "./pages/docs/Hetzner";
import R2 from "./pages/docs/R2";
import S3 from "./pages/docs/S3";
import Troubleshooting from "./pages/docs/Troubleshooting";
```
Then add these entries to `ROUTES`:
```tsx
  "/docs": GettingStarted,
  "/docs/s3": S3,
  "/docs/r2": R2,
  "/docs/hetzner": Hetzner,
  "/docs/troubleshooting": Troubleshooting,
```

- [ ] **Step 11: Build and check**

Run: `cd website && npm run build`
Expected: `prerender: wrote 6 pages`, and `check-dist` reports only the `og.png` problem.
Run: `grep -c 'aria-current="page"' dist/docs/r2/index.html`. Expected: `1`.

- [ ] **Step 12: Screenshot one docs page at 1280px and 375px**

Use the same preview and Chrome commands as Task 8 Step 5, with `http://localhost:4173/docs/r2/` and widths 1280 and 375. Expected:
- At 1280px, a sidebar with "Cloudflare R2" highlighted, numbered teal steps and a settings table.
- At 375px, the docs nav is a horizontal scrolling row above the content, with no page-level horizontal scroll.

- [ ] **Step 13: Commit**

```bash
git add -A website
git commit -m "Add docs pages: getting started, S3, R2, Hetzner, troubleshooting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Changelog and privacy pages

**Files:**
- Modify: `website/src/config.ts` (2 `PAGES` entries)
- Modify: `website/src/routes.tsx` (2 routes)
- Create: `website/src/components/ArticleLayout.tsx`
- Create: `website/src/content/changelog.ts`
- Create: `website/src/pages/Changelog.tsx`, `website/src/pages/Privacy.tsx`

**Interfaces:**
- Produces:
  - `ArticleLayout({ title, intro, children })`
  - `type Release = { version: string; date: string | null; items: string[] }`
  - `CHANGELOG: Release[]` (newest first)

- [ ] **Step 1: Add the pages to `PAGES` in `config.ts`**

```ts
  {
    path: "/changelog",
    title: "Changelog – Kelp",
    description: "What's new in each version of Kelp.",
  },
  {
    path: "/privacy",
    title: "Privacy – Kelp",
    description: "How Kelp handles your keys and files: Keychain only, no telemetry, no Kelp servers.",
  },
```
Run `cd website && npx tsc -b`. Expected: an error that `"/changelog"` and `"/privacy"` are missing in `routes.tsx`.

- [ ] **Step 2: Write `website/src/components/ArticleLayout.tsx`**

```tsx
import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

export function ArticleLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main">
        <div className="band theme-dark">
          <div className="container band-title">
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>
        </div>
        <article className="container article">
          <div className="prose">{children}</div>
        </article>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Write `website/src/content/changelog.ts`**

```ts
export type Release = {
  version: string;
  /** Release date such as "2026-11-02", or null while unreleased. */
  date: string | null;
  items: string[];
};

// Newest first. Add an entry before tagging a release.
export const CHANGELOG: Release[] = [
  {
    version: "0.1.0",
    date: null,
    items: [
      "Browse buckets and folders on Amazon S3, Cloudflare R2 and Hetzner Object Storage.",
      "Upload and download files with progress.",
      "Secret keys are stored in the macOS Keychain.",
      "Light and dark themes that follow your Mac, with a manual switch.",
      "Automatic updates.",
    ],
  },
];
```

- [ ] **Step 4: Write `website/src/pages/Changelog.tsx`**

```tsx
import { ArticleLayout } from "../components/ArticleLayout";
import { CHANGELOG } from "../content/changelog";

export default function Changelog() {
  return (
    <ArticleLayout title="Changelog" intro="What's new in each version of Kelp.">
      {CHANGELOG.map((release, i) => (
        <section key={release.version} className="release" aria-labelledby={`v${release.version}`}>
          <div className="release-head">
            <h2 id={`v${release.version}`}>Version {release.version}</h2>
            {release.date === null ? (
              <span className="badge">Not released yet</span>
            ) : (
              <>
                {i === 0 && <span className="badge badge-accent">Latest</span>}
                <p>
                  <time dateTime={release.date}>{release.date}</time>
                </p>
              </>
            )}
          </div>
          <ul>
            {release.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </ArticleLayout>
  );
}
```

- [ ] **Step 5: Write `website/src/pages/Privacy.tsx`**

```tsx
import { ArticleLayout } from "../components/ArticleLayout";
import { SITE } from "../config";

export default function Privacy() {
  return (
    <ArticleLayout
      title="Privacy"
      intro="Kelp keeps your data on your Mac and with your storage providers. Nothing else."
    >
      <h2>Your keys</h2>
      <p>
        Kelp saves each secret access key in the macOS Keychain, the same place macOS keeps your passwords. Secret
        keys are never written to Kelp's settings files, logs or crash reports.
      </p>

      <h2>Your files</h2>
      <p>
        Files move directly between your Mac and your storage provider. They never pass through a Kelp server,
        because there isn't one.
      </p>

      <h2>What Kelp connects to</h2>
      <ul>
        <li>The storage providers you add.</li>
        <li>GitHub, to check for and download updates.</li>
      </ul>

      <h2>Analytics</h2>
      <p>Kelp has no analytics or telemetry. It doesn't track how you use the app.</p>

      <h2>This website</h2>
      <p>
        This site sets no cookies and has no analytics. It saves your theme choice in your browser's local storage,
        and nothing else.
      </p>

      <h2>Questions</h2>
      <p>
        <a href={`${SITE.repoUrl}/issues`}>Open an issue on GitHub</a> if anything here is unclear.
      </p>

      <p>Last updated 14 October 2026.</p>
    </ArticleLayout>
  );
}
```

- [ ] **Step 6: Add the routes**

In `website/src/routes.tsx`, add the imports `import Changelog from "./pages/Changelog";` and `import Privacy from "./pages/Privacy";`, and the entries `"/changelog": Changelog,` and `"/privacy": Privacy,`.

- [ ] **Step 7: Build and check**

Run: `cd website && npm run build`
Expected: `prerender: wrote 8 pages`, and `check-dist` reports only the `og.png` problem.

- [ ] **Step 8: Screenshot `/changelog/` and `/privacy/` at 1280px**

Use the commands from Task 8 Step 5. Expected:
- A navy band with the h1 and intro, then a sand article column about 68 characters wide.
- The changelog shows a "Not released yet" badge.

- [ ] **Step 9: Commit**

```bash
git add -A website
git commit -m "Add changelog and privacy pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Share image

**Files:**
- Create: `design/reference/og.html`
- Create: `website/public/og.png` (exported)

**Interfaces:**
- Consumes: the tokens, fonts and `.bubbles` class. `head.ts` (Task 6) already points `og:image` at `/og.png`.

- [ ] **Step 1: Write `design/reference/og.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Kelp share image</title>
    <!-- Exported to website/public/og.png at 1200×630. See Task 11 in the design system plan. -->
    <link rel="stylesheet" href="../fonts/fonts.css" />
    <link rel="stylesheet" href="../tokens.css" />
    <link rel="stylesheet" href="../components.css" />
    <style>
      html, body { margin: 0; }
      .og { position: relative; width: 1200px; height: 630px; overflow: hidden; background: var(--hero-gradient); }
      .og-copy { position: relative; padding: 96px 96px 0; }
      .og-brand { display: flex; align-items: center; gap: 16px; font: 700 40px / 1 var(--font-display); }
      .og-brand svg { width: 56px; height: 56px; }
      .og h1 { margin: 56px 0 0; font: 800 96px / 1 var(--font-display); letter-spacing: -0.02em; }
      .og p { margin: 24px 0 0; max-width: 30ch; font: 400 30px / 1.4 var(--font-body); color: var(--text-muted); }
      .dot { position: absolute; border-radius: 50%; border: 2px solid var(--bubble-border); background: var(--bubble-fill); }
    </style>
  </head>
  <body>
    <div class="og theme-dark">
      <!-- Static bubbles: the screenshot must not depend on animation timing -->
      <span class="dot" style="left: 980px; top: 120px; width: 18px; height: 18px"></span>
      <span class="dot" style="left: 1060px; top: 260px; width: 10px; height: 10px"></span>
      <span class="dot" style="left: 910px; top: 330px; width: 26px; height: 26px"></span>
      <span class="dot" style="left: 1110px; top: 440px; width: 14px; height: 14px"></span>
      <span class="dot" style="left: 1010px; top: 520px; width: 8px; height: 8px"></span>
      <div class="og-copy">
        <div class="og-brand">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="15" style="fill: var(--accent)" />
            <path d="M16 22h32l-4 26a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3z" style="fill: var(--on-accent)" />
            <ellipse cx="32" cy="22" rx="16" ry="5" style="fill: var(--accent-soft)" />
          </svg>
          Kelp
        </div>
        <h1>Every bucket, one window.</h1>
        <p>A fast Mac app for Amazon S3, Cloudflare R2 and Hetzner Object Storage.</p>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Export it with headless Chrome**

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=3000 \
  --window-size=1200,630 --screenshot="$PWD/website/public/og.png" "file://$PWD/design/reference/og.html"
file website/public/og.png
```
Expected: `PNG image data, 1200 x 630`. Read the PNG. It should show the navy gradient, the Kelp mark and wordmark, the headline in Bricolage and the bubbles on the right. If the headline is in a fallback font, the font didn't load. Check the `--allow-file-access-from-files` flag.

- [ ] **Step 3: Build and check**

Run: `cd website && npm run build`
Expected: `check-dist: 8 pages, 404, sitemap and robots look right`, with exit code 0. This is the first fully green build.

- [ ] **Step 4: Commit**

```bash
git add design/reference/og.html website/public/og.png
git commit -m "Add share image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Rename to Kelp in the repo docs, and update CLAUDE.md

**Files:**
- Modify: `README.md`, `SPEC.md`, `CLAUDE.md`, `.github/workflows/release.yml`

- [ ] **Step 1: Find every old name**

Run: `grep -rn "Bucket Browser\|Bucket-Browser\|bucket.ozanai\|src/styles/" --include=*.md --include=*.yml . | grep -v docs/superpowers`
Expected: matches in `README.md:1`, `SPEC.md:1`, `SPEC.md` (the dmg name in section 9), `release.yml:48` and `CLAUDE.md:56`.

- [ ] **Step 2: Make the edits**

- `README.md`:
  - Line 1 becomes `# Kelp`.
  - In "Landing site", change `bucket.ozanai.dev` to `kelp.ozanai.dev`, and "Deploy the `dist/` folder to Cloudflare Pages or Netlify" to "Deploy to Cloudflare Pages (build command `npm run build`, root `website`, output `dist`)".
  - Add `npm test` under the website commands.
- `SPEC.md`:
  - Line 1 becomes `# Kelp – Specification`.
  - Replace the "> Working name…" line with `> App name: Kelp. Change it in website/src/config.ts, src-tauri/tauri.conf.json and package.json.`
  - Change `bucket-browser/` in the section 5.1 tree to `kelp/`.
  - In section 9, change `Bucket-Browser_aarch64.dmg` to `` `Kelp_<version>_aarch64.dmg` ``.
- `release.yml` line 48: `releaseName: "Kelp ${{ github.ref_name }}"`.
- `CLAUDE.md`:
  - Line 56 becomes `- Plain CSS with variables. Use the semantic tokens in design/tokens.css only (no raw hex or scale values outside that file). Shared components live in design/components.css; the reference sheet is design/reference/index.html.`
  - In "Commands", add:
    ```bash
    cd website && npm test                        # theme, path and contrast checks
    python3 -m http.server 8000 -d design         # then open http://localhost:8000/reference/
    ```
  - In "Website", add `- Pages are prerendered. A new page needs a PAGES entry in config.ts and a ROUTES entry in routes.tsx.`

- [ ] **Step 3: Verify**

Run the grep from Step 1 again. Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md SPEC.md CLAUDE.md .github/workflows/release.yml
git commit -m "Rename to Kelp and point docs at the design system

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Final verification against the spec's "Done when"

**Files:** none. Fix anything found in the task that owns it, and commit there.

- [ ] **Step 1: Run every automated check**

```bash
cd website && npm test && npm run build
cd .. && grep -rnE '#[0-9a-fA-F]{3,8}\b' website/src design/components.css; echo "hex grep exit: $?"
```
Expected: the tests pass, `check-dist` is green, and `hex grep exit: 1`, which means nothing was found.

- [ ] **Step 2: Check that content is visible without JavaScript**

Run: `sed -e 's/<[^>]*>//g' website/dist/docs/s3/index.html | grep -c "Create an access key"`
Expected: `1` or more. The text is in the HTML file itself.

- [ ] **Step 3: Check reduced motion and the theme switch in a real browser**

Run `cd website && npm run preview` and open `http://localhost:4173/` in Chrome:
1. Open DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce". Expected: the bubbles disappear and the demo progress bar stops.
2. Set "Emulate CSS prefers-color-scheme" to dark, then light. Expected: the page follows it while the switch is on System.
3. Choose Dark in the header switch, reload, and go to `/docs/`. Expected: still dark, with no flash of light on load. Choose System. Expected: it follows the emulation again.
4. Press Tab from the top of the page. Expected: "Skip to content" appears first, and every link, button and switch option shows a teal focus ring.
5. The console shows no hydration warnings on `/`, `/docs/r2/` or `/nope`.

- [ ] **Step 4: Run Lighthouse on the landing page and one docs page**

```bash
cd website && npx vite preview --port 4173 >/dev/null 2>&1 &
PREVIEW=$!; sleep 2
for p in "" "docs/r2/"; do
  npx --yes lighthouse "http://localhost:4173/$p" --quiet --chrome-flags="--headless" \
    --only-categories=performance,accessibility,best-practices,seo --output=json --output-path="$TMPDIR/lh.json"
  node -e 'const r=require(process.argv[1]);for(const c of Object.values(r.categories))console.log(c.title.padEnd(16),Math.round(c.score*100))' "$TMPDIR/lh.json"
done
kill $PREVIEW
```
Expected: every score is 95 or above. If SEO flags the canonical URL (it points at `kelp.ozanai.dev`, not localhost), that's expected locally, so note it and move on. Fix anything else in the owning task.

- [ ] **Step 5: Report**

Summarise for the user:
- What was built
- The final Lighthouse scores
- Anything checked by hand
- The open items: domain placeholder, `.dmg` name check on the first release, and the Cloudflare Pages setup, which they do in the Cloudflare dashboard
