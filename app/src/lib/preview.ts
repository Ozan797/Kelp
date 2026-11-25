import type { Row } from "../hooks/useListing";
import { fileKind } from "./format";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

const LARGEST_WHOLE_FILE = 50_000_000;
const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "flac", "aif", "aiff"]);
export const TEXT_LIMIT = 1024 * 1024;

export function previewUrl(connectionId: string, bucket: string, key: string): string {
  return `kelp-preview://localhost/${encodeURIComponent(connectionId)}?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
}

export function previewKind(row: Row): PreviewKind {
  if (row.isFolder) return "none";
  const extension = /\.([^.]+)$/.exec(row.name)?.[1]?.toLowerCase() ?? "";
  const fitsWhole = (row.size ?? 0) <= LARGEST_WHOLE_FILE;
  if (extension === "pdf") return fitsWhole ? "pdf" : "none";
  if (AUDIO.has(extension)) return "audio";
  const kind = fileKind(row.name, row.isFolder);
  if (kind === "image") return fitsWhole ? "image" : "none";
  if (kind === "video" || kind === "text") return kind;
  return "none";
}
