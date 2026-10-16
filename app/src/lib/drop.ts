import { formatBytes } from "./format";
import type { DropSummary } from "./tauri";

export type Place = { bucket: string; prefix: string };

export type DropZone = "list" | "folder" | "bucket" | "connection";

export type RowTarget = { kind: "place"; place: Place } | { kind: "connection"; connectionId: string };

export function rowDropTarget(element: Element | null, open: Place, dragged: string[], connectionId: string): RowTarget | null {
  const target = element?.closest<HTMLElement>("[data-drop]");
  if (!target) return null;
  const { drop, key, bucket, connection } = target.dataset;
  if (drop === "connection" && connection) return connection === connectionId ? null : { kind: "connection", connectionId: connection };
  if (drop === "bucket" && bucket) return bucket === open.bucket && open.prefix === "" ? null : { kind: "place", place: { bucket, prefix: "" } };
  if (drop !== "folder" || key === undefined) return null;
  if (key === open.prefix || dragged.some((d) => d.endsWith("/") && key.startsWith(d))) return null;
  return { kind: "place", place: { bucket: open.bucket, prefix: key } };
}

export function dropZone(element: Element | null): DropZone | null {
  const zone = element?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
  return zone === "list" || zone === "folder" || zone === "bucket" || zone === "connection" ? zone : null;
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
  const parts = [
    summary.folders > 0 ? count(summary.folders, "folder") : null,
    summary.loose > 0 ? count(summary.loose, "file") : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} · ${formatBytes(summary.bytes)}`;
}

export function destinationText(target: Place): string {
  return target.prefix === "" ? target.bucket : target.prefix;
}

export function pillText(summary: string, target: Place | null): string {
  return target ? `Upload ${summary} to ${destinationText(target)}` : "Drop on a folder or a bucket";
}
