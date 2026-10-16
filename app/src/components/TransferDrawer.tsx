import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Transfer } from "../hooks/useTransfers";
import { formatBytes } from "../lib/format";
import { transferSummary } from "./StatusBar";

type GroupId = "running" | "waiting" | "paused" | "failed" | "finished";

const GROUPS: { id: GroupId; label: string; matches: (t: Transfer) => boolean }[] = [
  { id: "running", label: "In progress", matches: (t) => t.status === "running" || t.status === "retrying" },
  { id: "waiting", label: "Waiting", matches: (t) => t.status === "waiting" },
  { id: "paused", label: "Paused", matches: (t) => t.status === "paused" },
  { id: "failed", label: "Failed", matches: (t) => t.status === "failed" },
  { id: "finished", label: "Finished", matches: (t) => t.status === "finished" || t.status === "cancelled" },
];

const ACTIVE = new Set(["waiting", "running", "retrying"]);

function fraction(t: Transfer): number {
  return t.total === 0 ? 0 : Math.min(t.done / t.total, 1);
}

function percent(t: Transfer): number {
  return Math.floor(fraction(t) * 100);
}

function secondsUntil(at: number | null, now: number): number {
  return at === null ? 0 : Math.max(Math.ceil((at - now) / 1000), 0);
}

function statusText(t: Transfer, now: number): string {
  if (t.status === "failed") return t.error ?? "Failed";
  if (t.status === "cancelled") return "Cancelled";
  if (t.status === "finished") {
    if (t.direction === "copy") return t.moving ? "Moved" : "Copied";
    return t.direction === "download" ? "Downloaded" : "Uploaded";
  }
  if (t.status === "waiting") return "Waiting";
  if (t.status === "paused") return `Paused at ${percent(t)}%`;
  if (t.status === "retrying") {
    const seconds = secondsUntil(t.retryAt, now);
    return seconds > 0 ? `Connection dropped · Retrying in ${seconds} s` : "Connection dropped · Retrying now";
  }
  if (t.kind === "folder") {
    return `${t.filesDone.toLocaleString("en-GB")} of ${t.filesTotal.toLocaleString("en-GB")} files · ${formatBytes(t.done)} of ${formatBytes(t.total)}`;
  }
  return `${percent(t)}% · ${formatBytes(t.done)} of ${formatBytes(t.total)}`;
}

function failedFiles(t: Transfer): string | null {
  if (t.kind !== "folder" || t.filesFailed === 0 || t.status === "failed") return null;
  return `${t.filesFailed.toLocaleString("en-GB")} ${t.filesFailed === 1 ? "file" : "files"} failed`;
}

function speedText(t: Transfer): string | null {
  if (t.status !== "running" || !t.speed) return null;
  const left = Math.ceil(Math.max(t.total - t.done, 0) / t.speed);
  const remaining = left < 60 ? `${left} s` : `${Math.ceil(left / 60)} min`;
  return `${formatBytes(t.speed)}/s · ${remaining} left`;
}

function destinationText(t: Transfer): string {
  if (t.direction !== "download") return `to ${t.destination}`;
  const folder = (t.path ?? t.destination).split("/").slice(0, -1).pop();
  return `to ${folder || "Downloads"}`;
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

type TransferDrawerProps = {
  transfers: Transfer[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onReveal: (path: string) => void;
  onClearFinished: () => void;
  onClose: () => void;
};

export function TransferDrawer({
  transfers,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onPauseAll,
  onResumeAll,
  onReveal,
  onClearFinished,
  onClose,
}: TransferDrawerProps) {
  const [open, setOpen] = useState<Record<GroupId, boolean>>({ running: true, waiting: false, paused: true, failed: true, finished: false });
  const now = useNow(transfers.some((t) => t.status === "retrying"));
  const anyActive = transfers.some((t) => ACTIVE.has(t.status));
  const anyPaused = transfers.some((t) => t.status === "paused");
  const [height, setHeight] = useState(260);
  const section = useRef<HTMLElement>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    section.current?.focus();
  }, []);

  const startResize = (event: ReactPointerEvent) => {
    drag.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resize = (event: ReactPointerEvent) => {
    if (!drag.current) return;
    const next = drag.current.startHeight + (drag.current.startY - event.clientY);
    setHeight(Math.min(Math.max(next, 140), window.innerHeight * 0.7));
  };

  return (
    <section
      ref={section}
      className="drawer"
      aria-label="Transfers"
      tabIndex={-1}
      style={{ height }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="drawer-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize transfers"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      <header className="drawer-head">
        <h2>Transfers</h2>
        <span className="drawer-summary">{transferSummary(transfers) ?? "Nothing in progress"}</span>
        <span className="spacer" />
        {anyActive && (
          <button type="button" className="button button-secondary" onClick={onPauseAll}>
            Pause all
          </button>
        )}
        {!anyActive && anyPaused && (
          <button type="button" className="button button-secondary" onClick={onResumeAll}>
            Resume all
          </button>
        )}
        <button type="button" className="button button-secondary" onClick={onClearFinished}>
          Clear finished
        </button>
        <button type="button" className="drawer-close" aria-label="Close transfers" onClick={onClose}>
          ⌄
        </button>
      </header>
      <div className="drawer-scroll">
        {GROUPS.map((group) => {
          const items = transfers.filter(group.matches);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="drawer-group">
              <button
                type="button"
                className="group-toggle"
                aria-expanded={open[group.id]}
                onClick={() => setOpen((current) => ({ ...current, [group.id]: !current[group.id] }))}
              >
                <span aria-hidden="true">{open[group.id] ? "▾" : "▸"}</span>
                {group.label} <span className={group.id === "failed" ? "count bad" : "count"}>{items.length}</span>
              </button>
              {open[group.id] && (
                <ul role="list">
                  {items.map((t) => (
                    <li key={t.id} className="transfer-row" tabIndex={0}>
                      <span className={`direction ${t.status}`} aria-hidden="true">
                        {t.status === "failed" ? "!" : t.status === "paused" ? "⏸" : t.status === "waiting" ? "·" : t.direction === "upload" ? "↑" : t.direction === "copy" ? "→" : "↓"}
                      </span>
                      <span className="transfer-name">
                        <strong>{t.name}</strong>
                        <small>{destinationText(t)}</small>
                        {failedFiles(t) && <small className="bad">{failedFiles(t)}</small>}
                        {(t.status === "running" || t.status === "retrying" || t.status === "paused") && (
                          <span className={t.status === "paused" ? "transfer-bar paused" : "transfer-bar"} aria-hidden="true">
                            <span style={{ transform: `scaleX(${fraction(t)})` }} />
                          </span>
                        )}
                      </span>
                      <span className={`transfer-status ${t.status === "failed" ? "bad" : t.status === "retrying" ? "warn" : ""}`}>
                        <span>{statusText(t, now)}</span>
                        {speedText(t) && <span>{speedText(t)}</span>}
                      </span>
                      <span className="transfer-actions">
                        {ACTIVE.has(t.status) && (
                          <button type="button" aria-label={`Pause ${t.name}`} onClick={() => onPause(t.id)}>
                            ⏸
                          </button>
                        )}
                        {t.status === "paused" && (
                          <button type="button" aria-label={`Resume ${t.name}`} onClick={() => onResume(t.id)}>
                            ▶
                          </button>
                        )}
                        {t.status === "failed" && (
                          <button
                            type="button"
                            className="button button-secondary"
                            aria-label={t.kind === "folder" ? `Retry failed files in ${t.name}` : `Retry ${t.name}`}
                            onClick={() => onRetry(t.id)}
                          >
                            {t.kind === "folder" ? "Retry failed" : "Retry"}
                          </button>
                        )}
                        {(ACTIVE.has(t.status) || t.status === "paused") && (
                          <button type="button" aria-label={`Cancel ${t.name}`} onClick={() => onCancel(t.id)}>
                            ✕
                          </button>
                        )}
                        {t.status === "failed" && (
                          <button type="button" aria-label={`Remove ${t.name}`} onClick={() => onCancel(t.id)}>
                            ✕
                          </button>
                        )}
                        {t.status === "finished" && t.path && (
                          <button type="button" className="button button-secondary" aria-label={`Show ${t.name} in Finder`} onClick={() => onReveal(t.path ?? "")}>
                            Show in Finder
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
