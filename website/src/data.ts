import type { Brand } from "./components/BrandLogo";

export type Entry = {
  name: string;
  kind: "folder" | "file";
  size?: string;
  modified: string;
  children?: Entry[];
};

export type Provider = {
  id: Brand;
  label: string;
  endpoint: string;
  root: Entry[];
};

const f = (name: string, size: string, modified: string): Entry => ({
  name,
  kind: "file",
  size,
  modified,
});

const d = (name: string, modified: string, children: Entry[]): Entry => ({
  name,
  kind: "folder",
  modified,
  children,
});

export const providers: Provider[] = [
  {
    id: "s3",
    label: "Amazon S3",
    endpoint: "eu-west-2",
    root: [
      d("acme-assets", "Today", [
        d("images", "Today", [
          f("hero-v3.webp", "412 KB", "Today"),
          f("team-photo.jpg", "2.4 MB", "Yesterday"),
          f("logo-dark.svg", "6 KB", "12 Oct"),
        ]),
        d("fonts", "9 Oct", [
          f("Inter-Variable.woff2", "318 KB", "9 Oct"),
          f("Mono.woff2", "96 KB", "9 Oct"),
        ]),
        f("manifest.json", "3 KB", "Today"),
      ]),
      d("acme-backups", "Yesterday", [
        f("db-2026-10-13.sql.gz", "1.2 GB", "Yesterday"),
        f("db-2026-10-12.sql.gz", "1.2 GB", "12 Oct"),
        f("db-2026-10-11.sql.gz", "1.1 GB", "11 Oct"),
      ]),
      d("acme-logs", "Today", [
        d("2026-10", "Today", [
          f("api-14.log.gz", "38 MB", "Today"),
          f("api-13.log.gz", "41 MB", "Yesterday"),
        ]),
      ]),
    ],
  },
  {
    id: "r2",
    label: "Cloudflare R2",
    endpoint: "auto",
    root: [
      d("media-cdn", "Today", [
        d("videos", "Today", [
          f("launch-teaser.mp4", "184 MB", "Today"),
          f("walkthrough.mp4", "512 MB", "11 Oct"),
        ]),
        d("thumbnails", "Today", [
          f("launch-teaser.jpg", "88 KB", "Today"),
          f("walkthrough.jpg", "92 KB", "11 Oct"),
        ]),
      ]),
      d("user-uploads", "Today", [
        f("avatar-4821.png", "64 KB", "Today"),
        f("avatar-4822.png", "71 KB", "Today"),
        f("invoice-0093.pdf", "128 KB", "Yesterday"),
      ]),
    ],
  },
  {
    id: "hetzner",
    label: "Hetzner",
    endpoint: "fsn1",
    root: [
      d("archive", "3 Oct", [
        d("2025", "3 Oct", [
          f("q1-export.parquet", "2.8 GB", "3 Oct"),
          f("q2-export.parquet", "3.1 GB", "3 Oct"),
        ]),
        f("README.txt", "1 KB", "3 Oct"),
      ]),
      d("model-checkpoints", "8 Oct", [
        f("run-14-epoch-30.pt", "940 MB", "8 Oct"),
        f("run-14-epoch-60.pt", "940 MB", "8 Oct"),
      ]),
    ],
  },
];

export const memoryScene = {
  endpoint: "Amazon S3",
  folders: [
    "acme-archive",
    "acme-assets",
    "acme-backups",
    "acme-exports",
    "acme-invoices",
    "acme-logs",
    "acme-media",
    "acme-reports",
    "acme-staging",
    "acme-uploads",
  ],
  opened: "acme-logs",
  inside: [
    { name: "2026-08", size: "—", modified: "31 Aug" },
    { name: "2026-09", size: "—", modified: "30 Sep" },
    { name: "2026-10", size: "—", modified: "Today" },
    { name: "index.json", size: "2 KB", modified: "Today" },
  ],
};
