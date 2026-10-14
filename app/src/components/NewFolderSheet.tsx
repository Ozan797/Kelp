import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toAppError, type AppError } from "../lib/tauri";

type NewFolderSheetProps = { onCreate: (name: string) => Promise<void>; onCancel: () => void };

const FOCUSABLE = "input:not([disabled]), button:not([disabled])";

export function NewFolderSheet({ onCreate, onCancel }: NewFolderSheetProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLFormElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab" || !sheet.current) return;
    const focusable = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onCreate(name);
    } catch (caught) {
      setError(toAppError(caught));
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onKeyDown={keyDown}>
      <form className="sheet small" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="folder-title" onSubmit={submit}>
        <h2 id="folder-title">New folder</h2>
        <div className="fields">
          <label htmlFor="folder-name">Name</label>
          <input
            id="folder-name"
            ref={field}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <p className="field-error" role="alert">
              {error.message}
            </p>
          )}
        </div>
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Create folder
          </button>
        </div>
      </form>
    </div>
  );
}
