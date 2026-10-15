import type { Row } from "../hooks/useListing";
import { fileKind } from "./format";

export type PreviewKind = "image" | "video" | "text" | "none";

const LARGEST_IMAGE = 50_000_000;
export const TEXT_LIMIT = 1024 * 1024;

export function previewUrl(connectionId: string, bucket: string, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `kelp-preview://localhost/${encodeURIComponent(connectionId)}/${encodeURIComponent(bucket)}/${path}`;
}

export function previewKind(row: Row): PreviewKind {
  const kind = fileKind(row.name, row.isFolder);
  if (kind === "image") return (row.size ?? 0) <= LARGEST_IMAGE ? "image" : "none";
  if (kind === "video" || kind === "text") return kind;
  return "none";
}
