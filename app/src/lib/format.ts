const UNITS = ["KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  let value = bytes;
  let unit = -1;
  while (Math.round(value) >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${UNITS[unit]}`;
}

export function formatCount(count: number): string {
  if (count < 10_000) return count.toLocaleString("en-GB");
  if (count < 1_000_000) return `${Math.round(count / 1000)} K`;
  const millions = count / 1_000_000;
  return `${millions < 10 ? Math.round(millions * 10) / 10 : Math.round(millions)} M`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatAge(at: number, now: number = Date.now()): string {
  const elapsed = Math.max(now - at, 0);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatModified(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (sameDay(date, now)) {
    return `Today ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  const dayMonth = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return date.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth} ${date.getFullYear()}`;
}

export function displayName(key: string, prefix: string): string {
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

export type FileKind = "folder" | "video" | "image" | "text" | "other";

const KIND_BY_EXTENSION = new Map<string, FileKind>([
  ...["mp4", "mov", "mkv", "webm", "avi", "m4v"].map((ext) => [ext, "video"] as const),
  ...["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "avif"].map((ext) => [ext, "image"] as const),
  ...["txt", "md", "json", "csv", "log", "yml", "yaml", "xml", "html"].map((ext) => [ext, "text"] as const),
]);

export function fileKind(name: string, isFolder: boolean): FileKind {
  if (isFolder) return "folder";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "other";
  return KIND_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? "other";
}
