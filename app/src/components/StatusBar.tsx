import type { Ref } from "react";
import type { Transfer } from "../hooks/useTransfers";
import { formatBytes } from "../lib/format";

const plural = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

const inProgress = (t: Transfer) => t.status === "running" || t.status === "retrying" || t.status === "waiting";

export function transferSummary(transfers: Transfer[]): string | null {
  const running = transfers.filter(inProgress);
  const paused = transfers.filter((t) => t.status === "paused").length;
  const failed = transfers.filter((t) => t.status === "failed").length;
  const finished = transfers.filter((t) => t.status === "finished").length;
  const parts: string[] = [];
  if (running.length === 0 && finished > 0) parts.push(`${finished} finished`);
  if (running.length > 0) {
    const uploads = running.every((t) => t.direction === "upload");
    const downloads = running.every((t) => t.direction === "download");
    const verb = uploads ? "Uploading" : downloads ? "Downloading" : "Transferring";
    const total = running.reduce((sum, t) => sum + t.total, 0);
    const done = running.reduce((sum, t) => sum + t.done, 0);
    const percent = total === 0 ? 0 : Math.floor((done / total) * 100);
    parts.push(`${verb} ${plural(running.length)}`, `${percent}%`);
  }
  if (paused > 0) parts.push(`${paused} paused`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (parts.length === 0 && transfers.length > 0) parts.push(`${transfers.length} cancelled`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

type StatusBarProps = {
  itemCount: number | null;
  selectedCount: number;
  selectedBytes: number;
  transfers: Transfer[];
  onOpenTransfers: () => void;
  pillRef?: Ref<HTMLButtonElement>;
};

export function StatusBar({ itemCount, selectedCount, selectedBytes, transfers, onOpenTransfers, pillRef }: StatusBarProps) {
  const summary = transferSummary(transfers);
  const running = transfers.filter(inProgress);
  const total = running.reduce((sum, t) => sum + t.total, 0);
  const done = running.reduce((sum, t) => sum + t.done, 0);
  return (
    <footer className="statusbar">
      <span>
        {itemCount !== null && `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
        {selectedCount > 0 && ` · ${selectedCount} selected · ${formatBytes(selectedBytes)}`}
      </span>
      {summary && (
        <button type="button" ref={pillRef} className="transfer-pill" onClick={onOpenTransfers}>
          {running.length > 0 && <span className="spinner" aria-hidden="true" />}
          {summary}
          {running.length > 0 && (
            <span className="pill-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${total === 0 ? 0 : done / total})` }} />
            </span>
          )}
        </button>
      )}
    </footer>
  );
}
