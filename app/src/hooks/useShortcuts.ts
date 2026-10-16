import { useEffect, useRef } from "react";

const CODES: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Comma: ",", Space: "Space" };

export function shortcutOf(event: KeyboardEvent): string {
  const key = CODES[event.code] ?? (event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return `${event.metaKey ? "Mod+" : ""}${event.shiftKey ? "Shift+" : ""}${key}`;
}

function modalOpen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((dialog) => dialog.closest("[hidden]") === null);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useShortcuts(map: Record<string, () => void>, enabled: boolean) {
  const latest = useRef(map);
  latest.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || modalOpen()) return;
      const action = latest.current[shortcutOf(event)];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
