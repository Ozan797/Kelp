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
