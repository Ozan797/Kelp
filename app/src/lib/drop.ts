import { formatBytes } from "./format";
import type { DropSummary } from "./tauri";

export type Place = { bucket: string; prefix: string };

export function toCssPoint(x: number, y: number, ratio: number): { x: number; y: number } {
  return { x: x / ratio, y: y / ratio };
}

export function dropTarget(element: Element | null, open: Place | null): Place | null {
  const target = element?.closest<HTMLElement>("[data-drop]");
  if (!target) return null;
  const { drop, key, bucket } = target.dataset;
  if (drop === "bucket" && bucket) return { bucket, prefix: "" };
  if (!open) return null;
  if (drop === "folder" && key) return { bucket: open.bucket, prefix: key };
  if (drop === "list") return open;
  return null;
}

const count = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;

export function summaryText(summary: DropSummary | null, items: number): string {
  if (!summary) return count(items, "item");
  const looseFiles = summary.folders === 0 ? summary.files : items - summary.folders;
  const parts = [
    summary.folders > 0 ? count(summary.folders, "folder") : null,
    looseFiles > 0 ? count(looseFiles, "file") : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} · ${formatBytes(summary.bytes)}`;
}

export function destinationText(target: Place): string {
  return target.prefix === "" ? target.bucket : target.prefix;
}

export function pillText(summary: string, target: Place | null): string {
  return target ? `Upload ${summary} to ${destinationText(target)}` : "Drop on a folder or a bucket";
}
