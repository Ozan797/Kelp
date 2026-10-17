export type Change = { title: string; body: string };

export type ReleaseNote = {
  version: string;
  date: string;
  summary: string;
  changes: readonly Change[];
  scene?: "folder-memory";
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.1.1",
    date: "2026-10-17",
    summary: "Kelp now remembers where you were in each folder.",
    scene: "folder-memory",
    changes: [
      {
        title: "Back where you were",
        body: "Go into a folder and back out, and the list is exactly where you left it, however many files it holds.",
      },
      {
        title: "Folders open instantly",
        body: "Folders you've visited this session appear at once, then refresh quietly in the background.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-16",
    summary: "The first release of Kelp.",
    changes: [
      {
        title: "S3, R2 and Hetzner in one app",
        body: "Browse, upload, download, copy and move files across Amazon S3, Cloudflare R2 and Hetzner Object Storage.",
      },
      {
        title: "Keys behind Touch ID",
        body: "Your secret keys stay in the macOS Keychain, unlocked with Touch ID once per launch.",
      },
      {
        title: "Fast, resumable transfers",
        body: "Big files go up and down in parallel parts, pause and resume, and pick up where they stopped after a restart.",
      },
      {
        title: "Updates itself",
        body: "Kelp is signed and notarised by Apple and installs new versions with one click.",
      },
    ],
  },
];

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function noteFor(
  version: string,
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote | null {
  return notes.find((n) => n.version === version) ?? null;
}

export function publishedNotes(
  live: string | null,
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote[] {
  if (live === null) return [];
  return notes.filter((n) => compareVersions(n.version, live) <= 0);
}

export function releaseMarkdown(note: ReleaseNote): string {
  const lines = note.changes.map((c) => `- **${c.title}.** ${c.body}`);
  return `${note.summary}\n\n${lines.join("\n")}\n`;
}
