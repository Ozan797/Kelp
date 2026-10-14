// One place to edit when the app gets a real name, domain or release.
export const SITE = {
  name: "Bucket Browser", // working name, rename freely
  domain: "bucket.ozanai.dev", // placeholder subdomain
  version: "0.1.0",
  // Flip to true once the first .dmg is attached to a GitHub Release.
  released: false,
  downloadUrl:
    "https://github.com/OWNER/bucket-browser/releases/latest/download/Bucket-Browser_aarch64.dmg",
  repoUrl: "https://github.com/OWNER/bucket-browser",
  minMacOS: "macOS 13",
} as const;
