import { downloadUrl, type Release } from "./release";

export const SITE = {
  name: "Kelp",
  domain: "kelp.ozanai.dev",
  url: "https://kelp.ozanai.dev",
  repoUrl: "https://github.com/Ozan797/Kelp",
  minMacOS: "macOS 13",
} as const;

export const RELEASE: Release | null = __KELP_RELEASE__;

export const DOWNLOAD_URL: string | null = RELEASE ? downloadUrl(RELEASE) : null;

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
  {
    path: "/whats-new",
    title: "What's new – Kelp",
    description: "What changed in each version of Kelp.",
  },
  {
    path: "/privacy",
    title: "Privacy – Kelp",
    description: "How Kelp handles your keys and files: Keychain only, no telemetry, no Kelp servers.",
  },
] as const satisfies readonly PageMeta[];

export type PagePath = (typeof PAGES)[number]["path"];

export const NOT_FOUND: PageMeta = {
  path: "/404",
  title: "Page not found – Kelp",
  description: "This page doesn't exist.",
};

/** Link target for an internal page. The host serves folders with a trailing slash. */
export const hrefFor = (path: string) => (path === "/" ? "/" : `${path}/`);

/** Absolute URL for canonical links and the sitemap. */
export const pageUrl = (path: string) => `${SITE.url}${hrefFor(path)}`;
