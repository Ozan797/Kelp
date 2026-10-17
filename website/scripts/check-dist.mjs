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

/** True when the page has no theme switch, or its "system" radio is prerendered as checked (attribute order varies). */
function systemChecked(html) {
  if (!html.includes('class="theme-switch"')) return true;
  const input = html.match(/<input[^>]*value="system"[^>]*>/)?.[0] ?? "";
  return /\bchecked(="")?[\s/>]/.test(input);
}
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
  if (!html.includes(`<div id="root" data-page="${page.path}">`)) problems.push(`${page.path}: #root must name its prerendered page (hydration)`);
  if (/href="\/#download"[^>]*>Download</.test(html)) problems.push(`${page.path}: header link says "Download" but only scrolls to the download section`);
  if (!systemChecked(html)) problems.push(`${page.path}: theme switch must prerender with "system" checked (hydration)`);
}

const olderOrEqual = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return true;
};
const whatsNew = read(join(dist, "whats-new", "index.html"));
const liveVersion = process.env.KELP_RELEASE_VERSION;
if (liveVersion && whatsNew === null) problems.push("/whats-new: no index.html in dist");
if (whatsNew !== null && liveVersion) {
  if (!whatsNew.includes(`id="${liveVersion}"`)) problems.push(`/whats-new: no section for ${liveVersion}`);
  for (const [, id] of whatsNew.matchAll(/<section[^>]*\sid="(\d+(?:\.\d+)*)"/g)) {
    if (!olderOrEqual(id, liveVersion)) problems.push(`/whats-new: section ${id} is newer than the live ${liveVersion}`);
  }
}

const home = read(join(dist, "index.html")) ?? "";
if (!home.includes('"@type":"SoftwareApplication"')) problems.push("/: no SoftwareApplication JSON-LD");

const notFound = read(join(dist, "404.html")) ?? "";
if (!notFound.includes('name="robots" content="noindex"')) problems.push("404.html: missing or not noindex");
if (!notFound.includes("drifted off")) problems.push("404.html: missing its message");
if (!notFound.includes(`<div id="root" data-page="${NOT_FOUND.path}">`)) problems.push("404.html: #root must name its prerendered page (hydration)");
if (!systemChecked(notFound)) problems.push('404.html: theme switch must prerender with "system" checked (hydration)');

const sitemap = read(join(dist, "sitemap.xml")) ?? "";
for (const page of PAGES) {
  if (!sitemap.includes(`<loc>${pageUrl(page.path)}</loc>`)) problems.push(`sitemap: missing ${page.path}`);
}
if (sitemap.includes(NOT_FOUND.path)) problems.push("sitemap: must not list the 404 page");
if (!(read(join(dist, "robots.txt")) ?? "").includes("Sitemap:")) problems.push("robots.txt: missing or no Sitemap line");
for (const file of ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "logo.svg"]) {
  if (!existsSync(join(dist, file))) problems.push(`${file}: missing from dist (run node design/brand/build.mjs)`);
}
if (!home.includes('rel="apple-touch-icon"')) problems.push("/: no apple-touch-icon link");
if (!existsSync(join(dist, "og.png"))) problems.push("og.png: missing from dist (Task 11)");

if (problems.length) {
  console.error(`check-dist found ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-dist: ${PAGES.length} pages, 404, sitemap and robots look right`);
