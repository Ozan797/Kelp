import { useEffect, useRef, type KeyboardEvent } from "react";
import { formatBytes } from "../lib/format";
import type { FolderPlan } from "../lib/tauri";

type MoveSheetProps = {
  count: number;
  plan: FolderPlan;
  destination: string;
  from: string;
  onMove: () => void;
  onCancel: () => void;
};

const items = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "item" : "items"}`;
const files = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "file" : "files"}`;

export function MoveSheet({ count, plan, destination, from, onMove, onCancel }: MoveSheetProps) {
  const move = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    move.current?.focus();
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") onCancel();
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  };

  return (
    <div className="sheet-backdrop" onKeyDown={keyDown}>
      <div className="sheet small" role="dialog" aria-modal="true" aria-labelledby="move-title">
        <h2 id="move-title">
          Move {items(count)} to {destination}?
        </h2>
        <p className="sheet-note">
          {files(plan.files)} · {formatBytes(plan.bytes)}. They will be removed from {from}.
        </p>
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" ref={move} className="button button-primary" onClick={onMove}>
            Move {items(count)}
          </button>
        </div>
      </div>
    </div>
  );
}
