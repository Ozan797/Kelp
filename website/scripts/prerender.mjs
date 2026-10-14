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
