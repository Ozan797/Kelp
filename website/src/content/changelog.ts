export type ChangeType = "new" | "improved" | "fixed";

export type Release = {
  version: string;
  /** Release date such as "2026-11-02", or null while unreleased. */
  date: string | null;
  /** One sentence on what this release is about. */
  summary: string;
  changes: { type: ChangeType; text: string }[];
};

// Newest first. Add an entry before tagging a release.
export const CHANGELOG: Release[] = [
  {
    version: "0.1.0",
    date: null,
    summary: "The first version of Kelp: browse your buckets and move files on all three providers.",
    changes: [
      { type: "new", text: "Browse buckets and folders on Amazon S3, Cloudflare R2 and Hetzner Object Storage." },
      { type: "new", text: "Upload and download files with progress." },
      { type: "new", text: "Secret keys are stored in the macOS Keychain." },
      { type: "new", text: "Light and dark themes that follow your Mac, with a manual switch." },
      { type: "new", text: "Automatic updates." },
    ],
  },
];

/** Work planned in SPEC.md milestones M3 and M4. No dates: plans can change. */
export const PLANNED: { title: string; items: string[] }[] = [
  {
    title: "Transfers",
    items: [
      "A transfer queue with pause, resume, cancel and automatic retries.",
      "Multipart uploads and parallel downloads for large files.",
      "Upload and download whole folders.",
    ],
  },
  {
    title: "Polish",
    items: [
      "Command palette (⌘K) and full keyboard navigation.",
      "Drag and drop from Finder and between connections.",
      "Quick previews for images, text and video.",
      "Tabs for several connections at once.",
    ],
  },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "2026-11-02" → "2 November 2026". Formatted by hand, not with toLocaleDateString,
 * so the prerendered HTML and the browser always produce the same text (no hydration mismatch).
 */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
