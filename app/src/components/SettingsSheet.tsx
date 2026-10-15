import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Theme } from "../lib/tauri";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

type SettingsSheetProps = { theme: Theme; onTheme: (theme: Theme) => void; onClose: () => void };

export function SettingsSheet({ theme, onTheme, onClose }: SettingsSheetProps) {
  const done = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    done.current?.focus();
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab" || !sheet.current) return;
    const stops = Array.from(sheet.current.querySelectorAll<HTMLElement>("input:checked, button"));
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="sheet-backdrop" onKeyDown={keyDown}>
      <div ref={sheet} className="sheet small" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>
        <p className="sheet-note">Saved on this Mac.</p>
        <fieldset className="segmented" role="radiogroup" aria-labelledby="appearance-label">
          <legend id="appearance-label">Appearance</legend>
          {THEMES.map((option) => (
            <label key={option.value} className={option.value === theme ? "segment selected" : "segment"}>
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={option.value === theme}
                onChange={() => onTheme(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" ref={done} className="button button-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
