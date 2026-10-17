import { useEffect, useRef, useState } from "react";
import type { useUpdater } from "../hooks/useUpdater";
import { api } from "../lib/tauri";

type UpdateStatusProps = { updater: ReturnType<typeof useUpdater>; runningTransfers: number };

export function UpdateStatus({ updater, runningTransfers }: UpdateStatusProps) {
  const { ready, cardOpen, message, openCard, closeCard, dismiss, restart, claimPulse } = updater;
  const wrapper = useRef<HTMLSpanElement>(null);
  const indicator = useRef<HTMLButtonElement>(null);

  const [pulse, setPulse] = useState(false);
  const version = ready?.version;

  useEffect(() => {
    setPulse(version !== undefined && claimPulse(version));
  }, [version, claimPulse]);

  const showsMessage = message !== null;

  useEffect(() => {
    if (!cardOpen) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== indicator.current) return;
    wrapper.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, [cardOpen, showsMessage]);

  useEffect(() => {
    if (!cardOpen) return;
    const insideWrapper = () => document.activeElement instanceof Node && !!wrapper.current?.contains(document.activeElement);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && insideWrapper()) closeCard();
    };
    const onPointer = (event: MouseEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) closeCard();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      if (document.activeElement && document.activeElement !== document.body) return;
      indicator.current?.focus();
    };
  }, [cardOpen, closeCard]);

  if (!ready && !message) return null;

  const closeButton = (onClick: () => void, focusClose = false) => (
    <button type="button" className="update-card-close" aria-label="Close" data-initial-focus={focusClose ? "" : undefined} onClick={onClick}>
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <path d="M3 3l8 8M11 3l-8 8" />
      </svg>
    </button>
  );

  return (
    <span className="update-status" ref={wrapper}>
      {ready && (
        <button type="button" ref={indicator} className={pulse ? "update-indicator pulse" : "update-indicator"} aria-label={`Update ready, Kelp ${ready.version}`} onClick={openCard}>
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 2v7M4 6.5L7 9.5l3-3M2.5 12h9" />
          </svg>
          Update ready
        </button>
      )}
      {cardOpen && message && (
        <div className="update-card" role="dialog" aria-label="Updates" aria-describedby="update-card-message">
          <p id="update-card-message" className="update-card-text">{message}</p>
          {closeButton(closeCard, true)}
        </div>
      )}
      {cardOpen && !message && ready && (
        <div className="update-card" role="dialog" aria-labelledby="update-card-title">
          <h2 id="update-card-title">Kelp {ready.version} is ready</h2>
          {ready.notes && <p className="update-card-text">{ready.notes}</p>}
          <div className="update-card-actions">
            <button type="button" className="button button-secondary" data-initial-focus="" onClick={() => void api.openDocs(`/whats-new/#${ready.version}`)}>
              What's new
            </button>
            <button type="button" className="button button-primary" onClick={() => void restart(runningTransfers)}>
              Restart to update
            </button>
          </div>
          {closeButton(dismiss)}
        </div>
      )}
    </span>
  );
}
