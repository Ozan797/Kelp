import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Tab } from "../hooks/useTabs";
import type { ConnectionProfile } from "../lib/tauri";
import { BrandLogo } from "./BrandLogo";

type TabStripProps = {
  tabs: Tab[];
  activeId: string;
  connections: ConnectionProfile[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
};

export function tabLabel(tab: Tab, connection: ConnectionProfile | undefined): string {
  if (!tab.place) return connection?.name ?? "New tab";
  const folder = tab.place.prefix.split("/").filter(Boolean).pop();
  return folder ? `${tab.place.bucket} / ${folder}` : tab.place.bucket;
}

export function TabStrip({ tabs, activeId, connections, onSelect, onClose, onNew }: TabStripProps) {
  const list = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);

  useEffect(() => {
    if (!keyboard.current) return;
    keyboard.current = false;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [activeId, tabs.length]);

  if (tabs.length < 2) return null;
  const at = tabs.findIndex((tab) => tab.id === activeId);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      keyboard.current = true;
      onSelect(tabs[(moves[event.key] + tabs.length) % tabs.length].id);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      keyboard.current = true;
      onClose(activeId);
    }
  };

  return (
    <div className="tab-strip">
      <div ref={list} role="tablist" aria-label="Tabs" className="tab-list" onKeyDown={keyDown}>
        {tabs.map((tab) => {
          const connection = connections.find((c) => c.id === tab.connectionId);
          const label = tabLabel(tab, connection);
          const active = tab.id === activeId;
          const path = tab.place ? `${tab.place.bucket}/${tab.place.prefix}` : label;
          return (
            <span key={tab.id} className={active ? "tab active" : "tab"}>
              <button
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`tab-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                title={path}
                className="tab-select"
                onClick={() => onSelect(tab.id)}
              >
                {connection && <BrandLogo brand={connection.settings.kind} className={`provider-logo ${connection.settings.kind}`} />}
                <span>{label}</span>
              </button>
              <span className="tab-close" aria-hidden="true" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => onClose(tab.id)}>
                ✕
              </span>
            </span>
          );
        })}
      </div>
      <button type="button" className="tab-new" aria-label="New tab" title="New tab" onClick={onNew}>
        ＋
      </button>
    </div>
  );
}
