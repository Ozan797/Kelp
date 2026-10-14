// Builds every Kelp logo file from the one drawing below.
// Run from the repo root: node design/brand/build.mjs   (needs Google Chrome; uses macOS `sips`)
//
// Writes:
//   design/brand/kelp-mark.svg       logo tile, full bleed (website header, lockups, share image)
//   design/brand/kelp-icon.svg       macOS app icon on Apple's grid: 824px tile with shadow on a 1024 canvas
//   design/brand/kelp-icon-1024.png  source for `npm run tauri icon design/brand/kelp-icon-1024.png`
//   website/public/logo.svg          copy of kelp-mark.svg for the site
//   website/public/favicon.svg       simplified tile (no bubble) for browser tabs
//   website/public/favicon.ico       16, 32 and 48px, for old browsers
//   website/public/apple-touch-icon.png  180px, square (iOS rounds the corners itself)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const brand = join(root, "design/brand");
const site = join(root, "website/public");
const tmp = mkdtempSync(join(tmpdir(), "kelp-brand-"));

// Deep water palette (design/tokens.css).
const defs = `
  <defs>
    <linearGradient id="kelp-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c1a26"/><stop offset="0.6" stop-color="#0c1620"/><stop offset="1" stop-color="#135049"/>
    </linearGradient>
    <radialGradient id="kelp-glow" cx="0.5" cy="0.75" r="0.6">
      <stop offset="0" stop-color="#35c2ad" stop-opacity="0.45"/><stop offset="1" stop-color="#35c2ad" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="kelp-leaf" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#14806f"/><stop offset="1" stop-color="#5fd6c4"/>
    </linearGradient>
    <filter id="kelp-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>`;

// The K: the stem is a kelp stalk, the arms are two blades. Drawn on a 1024 grid.
const glyph = (bubble) => `
    <rect x="318" y="236" width="104" height="572" rx="52" fill="#e6f5f1"/>
    <path d="M418 560 C 494 430, 596 318, 742 250 C 738 400, 610 520, 418 580 Z" fill="url(#kelp-leaf)"/>
    <path d="M418 540 C 604 574, 712 668, 752 812 C 600 806, 482 700, 418 580 Z" fill="#35c2ad"/>${
      bubble ? `\n    <circle cx="742" cy="168" r="30" fill="none" stroke="#9fe7dd" stroke-width="10"/>` : ""
    }`;

const tile = (rx, bubble) => `
    <rect width="1024" height="1024" rx="${rx}" fill="url(#kelp-bg)"/>
    <rect width="1024" height="1024" rx="${rx}" fill="url(#kelp-glow)"/>${glyph(bubble)}`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}${body}\n</svg>\n`;

const mark = svg(`\n  <g>${tile(228, true)}\n  </g>`);
const favicon = svg(`\n  <g>${tile(228, false)}\n  </g>`);
const touch = svg(`\n  <g>${tile(0, false)}\n  </g>`);
// Apple's macOS grid: an 824px rounded tile (corner ~22%) centred on 1024, with a soft drop shadow.
const icon = svg(`\n  <g filter="url(#kelp-shadow)" transform="translate(100 100) scale(0.8047)">${tile(228, true)}\n  </g>`);

writeFileSync(join(brand, "kelp-mark.svg"), mark);
writeFileSync(join(brand, "kelp-icon.svg"), icon);
writeFileSync(join(site, "favicon.svg"), favicon);
copyFileSync(join(brand, "kelp-mark.svg"), join(site, "logo.svg"));
writeFileSync(join(tmp, "touch.svg"), touch);

/** Renders an SVG to a 1024px PNG with a transparent background, using headless Chrome. */
function render(svgPath, pngPath) {
  execFileSync(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
      "--window-size=1024,1024", `--screenshot=${pngPath}`, `file://${svgPath}`],
    { stdio: "ignore" },
  );
}
const resize = (src, size, out) => execFileSync("sips", ["-z", `${size}`, `${size}`, src, "--out", out], { stdio: "ignore" });

render(join(brand, "kelp-icon.svg"), join(brand, "kelp-icon-1024.png"));
render(join(tmp, "touch.svg"), join(tmp, "touch.png"));
resize(join(tmp, "touch.png"), 180, join(site, "apple-touch-icon.png"));
render(join(site, "favicon.svg"), join(tmp, "fav.png"));

// favicon.ico: an ICO header plus a directory, then each size stored as a PNG (supported since Windows Vista).
const sizes = [16, 32, 48];
const pngs = sizes.map((s) => {
  const out = join(tmp, `fav-${s}.png`);
  resize(join(tmp, "fav.png"), s, out);
  return readFileSync(out);
});
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(s, at); // width
  header.writeUInt8(s, at + 1); // height
  header.writeUInt16LE(1, at + 4); // colour planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
writeFileSync(join(site, "favicon.ico"), Buffer.concat([header, ...pngs]));

console.log("brand: wrote mark, app icon (svg + 1024 png), favicon.svg/.ico, apple-touch-icon, logo.svg");
