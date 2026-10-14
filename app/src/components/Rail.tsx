import type { ConnectionProfile, ProviderKind } from "../lib/tauri";
import { BrandLogo } from "./BrandLogo";

export const PROVIDER_NAMES: Record<ProviderKind, string> = { s3: "AWS", r2: "Cloudflare", hetzner: "Hetzner" };

type RailProps = {
  connections: ConnectionProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onContextMenu: (connection: ConnectionProfile) => void;
};

export function Rail({ connections, selectedId, onSelect, onAdd, onContextMenu }: RailProps) {
  return (
    <nav className="rail" aria-label="Connections" data-tauri-drag-region>
      <ul role="list">
        {connections.map((connection) => {
          const label = `${PROVIDER_NAMES[connection.settings.kind]} · ${connection.name}`;
          const selected = connection.id === selectedId;
          return (
            <li key={connection.id}>
              <button
                type="button"
                className={selected ? "tile selected" : "tile"}
                title={label}
                aria-label={label}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(connection.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onContextMenu(connection);
                }}
              >
                <BrandLogo brand={connection.settings.kind} className={`provider-logo ${connection.settings.kind}`} />
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="tile add" title="Add a connection" aria-label="Add a connection" onClick={onAdd}>
            +
          </button>
        </li>
      </ul>
    </nav>
  );
}
