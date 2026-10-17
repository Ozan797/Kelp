import type { ReactNode, Ref } from "react";
import type { Transfer } from "../hooks/useTransfers";
import { formatAge, formatBytes, formatCount } from "../lib/format";
import type { UsageView } from "../lib/tauri";

const plural = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

const inProgress = (t: Transfer) => t.status === "running" || t.status === "retrying" || t.status === "waiting";

export function overallFraction(transfers: Transfer[]): number {
  const running = transfers.filter(inProgress);
  const total = running.reduce((sum, t) => sum + t.total, 0);
  const done = running.reduce((sum, t) => sum + t.done, 0);
  return total === 0 ? 0 : Math.min(done / total, 1);
}

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

type Size = { usage: UsageView | null; now: number; onCalculate: () => void; onCancel: () => void };

function SizeText({ usage, now, onCalculate, onCancel }: Size) {
  const action = (label: string, onClick: () => void) => (
    <button type="button" className="link-button" onClick={onClick}>
      {label}
    </button>
  );
  if (!usage) return action("Calculate size", onCalculate);
  if (usage.counting) {
    return (
      <>
        <span className="size-progress">
          <span className="spinner" aria-hidden="true" />
          Counting · {formatCount(usage.objects)} files · {formatBytes(usage.bytes)} so far
        </span>
        {action("Cancel", onCancel)}
      </>
    );
  }
  if (usage.complete) {
    return (
      <>
        <span>
          {formatBytes(usage.bytes)} · {formatCount(usage.objects)} files · {formatAge(usage.countedAtMs, now)}
        </span>
        {action("Recalculate", onCalculate)}
      </>
    );
  }
  return (
    <>
      <span>{formatBytes(usage.bytes)} counted so far</span>
      {usage.error && <span className="size-error">{usage.error}</span>}
      {action("Continue", onCalculate)}
    </>
  );
}

type StatusBarProps = {
  itemCount: number | null;
  selectedCount: number;
  selectedBytes: number;
  transfers: Transfer[];
  onOpenTransfers: () => void;
  pillRef?: Ref<HTMLButtonElement>;
  size?: Size | null;
  update?: ReactNode;
  note?: string | null;
};

export function StatusBar({ itemCount, selectedCount, selectedBytes, transfers, onOpenTransfers, pillRef, size, update, note }: StatusBarProps) {
  const summary = transferSummary(transfers);
  const running = transfers.filter(inProgress);
  return (
    <footer className="statusbar">
      <span className="statusbar-info">
        <span>
          {itemCount !== null && `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
          {selectedCount > 0 && ` · ${selectedCount} selected · ${formatBytes(selectedBytes)}`}
        </span>
        {size && (
          <>
            <span aria-hidden="true">·</span>
            <SizeText {...size} />
          </>
        )}
        {note && (
          <>
            <span aria-hidden="true">·</span>
            <span className="statusbar-note">{note}</span>
          </>
        )}
      </span>
      {summary && (
        <button type="button" ref={pillRef} className="transfer-pill" onClick={onOpenTransfers} data-transfers-toggle>
          {running.length > 0 && <span className="spinner" aria-hidden="true" />}
          {summary}
          {running.length > 0 && (
            <span className="pill-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${overallFraction(transfers)})` }} />
            </span>
          )}
        </button>
      )}
      {update}
    </footer>
  );
}
