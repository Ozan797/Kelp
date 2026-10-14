import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Transfer } from "../hooks/useTransfers";
import { formatBytes } from "../lib/format";
import { transferSummary } from "./StatusBar";

type GroupId = "running" | "failed" | "finished";

const GROUPS: { id: GroupId; label: string; matches: (t: Transfer) => boolean }[] = [
  { id: "running", label: "In progress", matches: (t) => t.status === "running" },
  { id: "failed", label: "Failed", matches: (t) => t.status === "failed" },
  { id: "finished", label: "Finished", matches: (t) => t.status === "finished" || t.status === "cancelled" },
];

function fraction(t: Transfer): number {
  return t.total === 0 ? 0 : Math.min(t.done / t.total, 1);
}

function statusText(t: Transfer): string {
  if (t.status === "failed") return t.error?.message ?? "Failed";
  if (t.status === "cancelled") return "Cancelled";
  if (t.status === "finished") return t.direction === "download" ? "Downloaded" : "Uploaded";
  return `${Math.floor(fraction(t) * 100)}% · ${formatBytes(t.done)} of ${formatBytes(t.total)}`;
}

function destinationText(t: Transfer): string {
  if (t.direction === "upload") return `to ${t.destination}`;
  const folder = t.path?.split("/").slice(0, -1).pop();
  return `to ${folder || "Downloads"}`;
}

type TransferDrawerProps = {
  transfers: Transfer[];
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
  onClearFinished: () => void;
  onClose: () => void;
};

export function TransferDrawer({ transfers, onCancel, onReveal, onClearFinished, onClose }: TransferDrawerProps) {
  const [open, setOpen] = useState<Record<GroupId, boolean>>({ running: true, failed: true, finished: false });
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
                        {t.status === "failed" ? "!" : t.direction === "upload" ? "↑" : "↓"}
                      </span>
                      <span className="transfer-name">
                        <strong>{t.name}</strong>
                        <small>{destinationText(t)}</small>
                        {t.status === "running" && (
                          <span className="transfer-bar" aria-hidden="true">
                            <span style={{ transform: `scaleX(${fraction(t)})` }} />
                          </span>
                        )}
                      </span>
                      <span className={t.status === "failed" ? "transfer-status bad" : "transfer-status"}>{statusText(t)}</span>
                      <span className="transfer-actions">
                        {t.status === "running" && (
                          <button type="button" aria-label={`Cancel ${t.name}`} onClick={() => onCancel(t.id)}>
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
