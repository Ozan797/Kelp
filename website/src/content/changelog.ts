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
