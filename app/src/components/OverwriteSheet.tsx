import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import type { FolderPlan } from "../lib/tauri";

type OverwriteSheetProps = {
  plan: FolderPlan;
  what: string;
  destination: string;
  onCancel: () => void;
  onSkip: () => void;
  onReplace: () => void;
};

const files = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? "file" : "files"}`;

export function OverwriteSheet({ plan, what, destination, onCancel, onSkip, onReplace }: OverwriteSheetProps) {
  const skip = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLFormElement>(null);
  const existing = plan.existing.toLocaleString("en-GB");
  const more = plan.existing - plan.examples.length;

  useEffect(() => {
    skip.current?.focus();
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") onCancel();
    if (event.key !== "Tab" || !sheet.current) return;
    const buttons = Array.from(sheet.current.querySelectorAll<HTMLElement>("button"));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSkip();
  };

  return (
    <div className="sheet-backdrop" onKeyDown={keyDown}>
      <form className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="overwrite-title" onSubmit={submit}>
        <h2 id="overwrite-title">
          {plan.existing.toLocaleString("en-GB")} of {files(plan.files)} {plan.existing === 1 ? "is" : "are"} already here
        </h2>
        <p className="sheet-note">
          Uploading {what} to {destination} would replace them.
        </p>
        <ul className="clash-list">
          {plan.examples.map((key) => (
            <li key={key}>{key}</li>
          ))}
          {more > 0 && <li className="clash-more">and {more.toLocaleString("en-GB")} more</li>}
        </ul>
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" ref={skip} className="button button-secondary">
            Skip {existing} existing
          </button>
          <button type="button" className="button button-secondary destructive" onClick={onReplace}>
            Replace {files(plan.existing)}
          </button>
        </div>
      </form>
    </div>
  );
}
