export type ChangeKind = "new" | "improved" | "fixed";

export type Change = { title: string; body: string; kind: ChangeKind };

export type ChangeGroup = { kind: ChangeKind; label: string; changes: Change[] };

const GROUPS: readonly { kind: ChangeKind; label: string }[] = [
  { kind: "new", label: "New" },
  { kind: "improved", label: "Improved" },
  { kind: "fixed", label: "Fixed" },
];

export type ReleaseNote = {
  version: string;
  date: string;
  title: string;
  summary: string;
  changes: readonly Change[];
  scene?: "folder-memory" | "update-ready" | "transfers";
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.2.0",
    date: "2026-10-17",
    title: "Feels at home on your Mac",
    summary: "Kelp now looks and behaves more like a Mac app, with transfers one click away in the toolbar.",
    scene: "transfers",
    changes: [
      {
        title: "Transfers in the toolbar",
        body: "A transfers button next to Refresh shows progress at a glance. Click it to see every upload, download and copy, and click anywhere else to close it.",
        kind: "new",
      },
      {
        title: "More like a Mac app",
        body: "A frosted sidebar, the normal arrow cursor, and no stray text selection or web menus.",
        kind: "improved",
      },
      {
        title: "A calmer light theme",
        body: "Light mode uses cool greys instead of a warm sand tint.",
        kind: "improved",
      },
      {
        title: "Refresh you can see",
        body: "The refresh button spins while the folder reloads, and the status bar says when it's done.",
        kind: "improved",
      },
      {
        title: "Know what a delete will remove",
        body: "Deleting a folder now tells you how many files are inside before you confirm.",
        kind: "improved",
      },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-10-17",
    title: "Updates, quietly",
    summary: "Kelp now tells you about updates without getting in your way.",
    scene: "update-ready",
    changes: [
      {
        title: "Update ready",
        body: "When a new version has downloaded, a small \"Update ready\" shows at the end of the status bar. Click it to see what's new or restart to update.",
        kind: "new",
      },
      {
        title: "Finds updates sooner",
        body: "Kelp checks every 30 minutes while it's open, and again when you come back to it after a while.",
        kind: "improved",
      },
      {
        title: "What's new on the website",
        body: "Every version now has its own notes at kelp.ozanai.dev/whats-new, one click from the update card.",
        kind: "improved",
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-10-17",
    title: "Back where you were",
    summary: "Kelp now remembers where you were in each folder.",
    scene: "folder-memory",
    changes: [
      {
        title: "Back where you were",
        body: "Go into a folder and back out, and the list is exactly where you left it, however many files it holds.",
        kind: "new",
      },
      {
        title: "Folders open instantly",
        body: "Folders you've visited this session appear at once, then refresh quietly in the background.",
        kind: "improved",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-16",
    title: "The first release",
    summary: "The first release of Kelp.",
    changes: [
      {
        title: "S3, R2 and Hetzner in one app",
        body: "Browse, upload, download, copy and move files across Amazon S3, Cloudflare R2 and Hetzner Object Storage.",
        kind: "new",
      },
      {
        title: "Keys behind Touch ID",
        body: "Your secret keys stay in the macOS Keychain, unlocked with Touch ID once per launch.",
        kind: "new",
      },
      {
        title: "Fast, resumable transfers",
        body: "Big files go up and down in parallel parts, pause and resume, and pick up where they stopped after a restart.",
        kind: "new",
      },
      {
        title: "Updates itself",
        body: "Kelp is signed and notarised by Apple and installs new versions with one click.",
        kind: "new",
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

export function changeGroups(changes: readonly Change[]): ChangeGroup[] {
  return GROUPS.map(({ kind, label }) => ({ kind, label, changes: changes.filter((c) => c.kind === kind) })).filter(
    (group) => group.changes.length > 0,
  );
}

export function releaseMarkdown(note: ReleaseNote): string {
  const sections = changeGroups(note.changes).map(
    (group) => `### ${group.label}\n\n${group.changes.map((c) => `- **${c.title}.** ${c.body}`).join("\n")}\n`,
  );
  return `${note.summary}\n\n${sections.join("\n")}`;
}
