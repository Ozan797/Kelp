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
