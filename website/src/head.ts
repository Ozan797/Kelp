import { NOT_FOUND, PAGES, RELEASE, SITE, pageUrl, type PageMeta } from "./config";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function softwareJsonLd(): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    operatingSystem: `${SITE.minMacOS}+`,
    applicationCategory: "DeveloperApplication",
    ...(RELEASE ? { softwareVersion: RELEASE.version } : {}),
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
  const title = escapeHtml(SITE.name);
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
