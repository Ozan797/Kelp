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
  if (tabs.length < 2) return null;
  return (
    <div className="tab-strip">
      <div role="tablist" aria-label="Tabs" className="tab-list">
        {tabs.map((tab) => {
          const connection = connections.find((c) => c.id === tab.connectionId);
          const label = tabLabel(tab, connection);
          const active = tab.id === activeId;
          const path = tab.place ? `${tab.place.bucket}/${tab.place.prefix}` : label;
          return (
            <div key={tab.id} className={active ? "tab active" : "tab"}>
              <button type="button" role="tab" aria-selected={active} title={path} className="tab-select" onClick={() => onSelect(tab.id)}>
                {connection && <BrandLogo brand={connection.settings.kind} className={`provider-logo ${connection.settings.kind}`} />}
                <span>{label}</span>
              </button>
              <button type="button" className="tab-close" aria-label={`Close ${label}`} onClick={() => onClose(tab.id)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-new" aria-label="New tab" title="New tab" onClick={onNew}>
        ＋
      </button>
    </div>
  );
}
