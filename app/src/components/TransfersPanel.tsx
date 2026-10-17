import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Transfer } from "../hooks/useTransfers";
import { formatBytes } from "../lib/format";
import { overallFraction, transferSummary } from "./StatusBar";

const ORDER: Transfer["status"][] = ["running", "retrying", "failed", "waiting", "paused", "finished", "cancelled"];

export function sortedForPanel(transfers: Transfer[]): Transfer[] {
  return [...transfers].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
}

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


function directionGlyph(t: Transfer): string {
  if (t.status === "failed") return "!";
  if (t.direction === "upload") return "↑";
  if (t.direction === "copy") return "→";
  return "↓";
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="round-button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function MagnifierIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TransferRow({ t, now, actions }: { t: Transfer; now: number; actions: RowActions }) {
  const failed = failedFiles(t);
  const speed = speedText(t);
  return (
    <li className="transfer-row">
      <span className={`transfer-icon ${t.status}`} aria-hidden="true">
        {directionGlyph(t)}
      </span>
      <span className="transfer-body">
        <span className="transfer-title">
          <strong>{t.name}</strong>
          <small>{destinationText(t)}</small>
        </span>
        {(t.status === "running" || t.status === "retrying" || t.status === "paused") && (
          <span className={t.status === "paused" ? "transfer-bar paused" : "transfer-bar"} aria-hidden="true">
            <span style={{ transform: `scaleX(${fraction(t)})` }} />
          </span>
        )}
        <small className={`transfer-status ${t.status === "failed" ? "bad" : t.status === "retrying" ? "warn" : ""}`}>
          <span>{statusText(t, now)}</span>
          {speed && <span>{speed}</span>}
          {failed && <span className="bad">{failed}</span>}
        </small>
      </span>
      <span className="transfer-actions">
        {ACTIVE.has(t.status) && (
          <RoundButton label={`Pause ${t.name}`} onClick={() => actions.onPause(t.id)}>
            ⏸
          </RoundButton>
        )}
        {t.status === "paused" && (
          <RoundButton label={`Resume ${t.name}`} onClick={() => actions.onResume(t.id)}>
            ▶
          </RoundButton>
        )}
        {t.status === "failed" && (
          <RoundButton label={t.kind === "folder" ? `Retry failed files in ${t.name}` : `Retry ${t.name}`} onClick={() => actions.onRetry(t.id)}>
            ↻
          </RoundButton>
        )}
        {(ACTIVE.has(t.status) || t.status === "paused") && (
          <RoundButton label={`Cancel ${t.name}`} onClick={() => actions.onCancel(t.id)}>
            ✕
          </RoundButton>
        )}
        {t.status === "failed" && (
          <RoundButton label={`Remove ${t.name}`} onClick={() => actions.onCancel(t.id)}>
            ✕
          </RoundButton>
        )}
        {t.status === "finished" && t.path && (
          <RoundButton label={`Show ${t.name} in Finder`} onClick={() => actions.onReveal(t.path ?? "")}>
            <MagnifierIcon />
          </RoundButton>
        )}
      </span>
    </li>
  );
}

type RowActions = {
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
};

type TransfersPanelProps = RowActions & {
  transfers: Transfer[];
  onPauseAll: () => void;
  onResumeAll: () => void;
  onClearFinished: () => void;
  onClose: () => void;
};

function useCloseOnOutsidePress(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const press = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panel.current?.contains(target) || target.closest("[data-transfers-toggle]")) return;
      close.current();
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [panel]);
}

export function TransfersPanel({ transfers, onPauseAll, onResumeAll, onClearFinished, onClose, ...actions }: TransfersPanelProps) {
  const now = useNow(transfers.some((t) => t.status === "retrying"));
  const anyActive = transfers.some((t) => ACTIVE.has(t.status));
  const anyPaused = transfers.some((t) => t.status === "paused");
  const anyDone = transfers.some((t) => t.status === "finished" || t.status === "cancelled");
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    panel.current?.focus();
  }, []);

  useCloseOnOutsidePress(panel, onClose);

  return (
    <section
      ref={panel}
      className="transfers-panel"
      role="dialog"
      aria-label="Transfers"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
    >
      <header className="transfers-head">
        <h2>Transfers</h2>
        <span className="transfers-summary">{transferSummary(transfers) ?? "Nothing in progress"}</span>
        {anyActive && (
          <button type="button" className="link-button" onClick={onPauseAll}>
            Pause all
          </button>
        )}
        {!anyActive && anyPaused && (
          <button type="button" className="link-button" onClick={onResumeAll}>
            Resume all
          </button>
        )}
      </header>
      {transfers.length === 0 ? (
        <p className="transfers-empty">Uploads, downloads and copies show up here.</p>
      ) : (
        <ul role="list" className="transfers-list">
          {sortedForPanel(transfers).map((t) => (
            <TransferRow key={t.id} t={t} now={now} actions={actions} />
          ))}
        </ul>
      )}
      <footer className="transfers-foot">
        <span>
          {transfers.length} {transfers.length === 1 ? "transfer" : "transfers"}
        </span>
        <button type="button" className="link-button" disabled={!anyDone} onClick={onClearFinished}>
          Clear finished
        </button>
      </footer>
    </section>
  );
}

type TransfersButtonProps = { transfers: Transfer[]; open: boolean; pulse: number; onToggle: () => void };

export function TransfersButton({ transfers, open, pulse, onToggle }: TransfersButtonProps) {
  const running = transfers.some((t) => ACTIVE.has(t.status));
  const failed = transfers.some((t) => t.status === "failed");
  const progress = Math.round(overallFraction(transfers) * 100);
  return (
    <button
      type="button"
      className="toolbar-icon transfers-button"
      aria-label="Transfers"
      title="Transfers"
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={transfers.length === 0}
      onClick={onToggle}
      data-transfers-toggle
    >
      {running && (
        <svg className="transfers-ring" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="12.5" pathLength="100" strokeDasharray={`${progress} 100`} />
        </svg>
      )}
      <span key={pulse} className={pulse > 0 ? "transfers-glyph pulse" : "transfers-glyph"} aria-hidden="true">
        ↓↑
      </span>
      {failed && <span className="transfers-dot" aria-hidden="true" />}
    </button>
  );
}
