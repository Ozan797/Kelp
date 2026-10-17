import { downloadUrl, type Release } from "./release";

export const SITE = {
  name: "Kelp",
  domain: "kelp.ozanai.dev",
  url: "https://kelp.ozanai.dev",
  minMacOS: "macOS 13",
} as const;

export const RELEASE: Release | null = __KELP_RELEASE__;

export const DOWNLOAD_URL: string | null = RELEASE ? downloadUrl(RELEASE) : null;

export type PageMeta = { path: string; name: string; description: string };

// Every prerendered page. Every tab title is just the app name; `name` is announced on in-place navigation.
export const PAGES = [
  {
    path: "/",
    name: "Home",
    description:
      "Browse and transfer files across Amazon S3, Cloudflare R2 and Hetzner Object Storage from one fast Mac app.",
  },
  {
    path: "/docs",
    name: "Getting started",
    description: "Install Kelp and connect your first Amazon S3, Cloudflare R2 or Hetzner bucket.",
  },
  {
    path: "/docs/s3",
    name: "Connect Amazon S3",
    description: "Create an AWS access key and connect Amazon S3 to Kelp.",
  },
  {
    path: "/docs/r2",
    name: "Connect Cloudflare R2",
    description: "Create an R2 API token and connect Cloudflare R2 to Kelp.",
  },
  {
    path: "/docs/hetzner",
    name: "Connect Hetzner Object Storage",
    description: "Generate S3 credentials and connect Hetzner Object Storage to Kelp.",
  },
  {
    path: "/docs/troubleshooting",
    name: "Troubleshooting",
    description: "Fix common connection errors in Kelp.",
  },
  {
    path: "/whats-new",
    name: "What's new",
    description: "What changed in each version of Kelp.",
  },
  {
    path: "/privacy",
    name: "Privacy",
    description: "How Kelp handles your keys and files: Keychain only, no telemetry, no Kelp servers.",
  },
] as const satisfies readonly PageMeta[];

export type PagePath = (typeof PAGES)[number]["path"];

export const NOT_FOUND: PageMeta = {
  path: "/404",
  name: "Page not found",
  description: "This page doesn't exist.",
};

/** Link target for an internal page. The host serves folders with a trailing slash. */
export const hrefFor = (path: string) => (path === "/" ? "/" : `${path}/`);

/** Absolute URL for canonical links and the sitemap. */
export const pageUrl = (path: string) => `${SITE.url}${hrefFor(path)}`;
