import { useEffect, useRef, useState } from "react";
import mark from "../../design/brand/kelp-mark.svg";
import { Browser } from "./Browser";
import { ConnectionSheet } from "./components/ConnectionSheet";
import { EmptyState } from "./components/EmptyState";
import { Rail } from "./components/Rail";
import { SettingsSheet } from "./components/SettingsSheet";
import { StatusBar } from "./components/StatusBar";
import { TransferDrawer } from "./components/TransferDrawer";
import { useConnections } from "./hooks/useConnections";
import { useSettings } from "./hooks/useSettings";
import { useShortcuts } from "./hooks/useShortcuts";
import { useTransfers } from "./hooks/useTransfers";
import type { Place } from "./lib/drop";
import type { Command } from "./lib/palette";
import { api, toAppError, type AppError, type ConnectionProfile } from "./lib/tauri";

type Sheet = { kind: "none" } | { kind: "connection"; initial: ConnectionProfile | null } | { kind: "settings" };

export default function App() {
  const { connections, error: connectionsError, reload: reloadConnections } = useConnections();
  const { transfers, clearFinished } = useTransfers();
  const { settings, setTheme } = useSettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const lastPlaces = useRef<Record<string, Place>>({});

  const connection = connections?.find((c) => c.id === selectedId) ?? null;
  const report = (caught: unknown) => setActionError(toAppError(caught));

  useEffect(() => {
    if (connections && connections.length > 0 && !connections.some((c) => c.id === selectedId)) {
      setSelectedId(connections[0].id);
    }
  }, [connections, selectedId]);

  useShortcuts({ "Mod+,": () => setSheet({ kind: "settings" }) }, sheet.kind === "none");

  const connectionMenu = (profile: ConnectionProfile) => {
    api
      .showContextMenu([
        { label: "Edit connection…", onSelect: () => setSheet({ kind: "connection", initial: profile }) },
        "separator",
        {
          label: `Delete ${profile.name}…`,
          onSelect: async () => {
            const label = `Delete ${profile.name}`;
            if (!(await api.confirm(`Delete the connection "${profile.name}"? Your files aren't touched.`, label))) return;
            try {
              await api.deleteConnection(profile.id);
              await reloadConnections();
            } catch (caught) {
              report(caught);
            }
          },
        },
      ])
      .catch(() => undefined);
  };

  const appCommands = (): Command[] => {
    const actions: Command[] = [];
    const action = (id: string, label: string, run: () => void, shortcut?: string) => actions.push({ id, label, run, shortcut, group: "actions" });
    if (transfers.some((t) => t.status === "running" || t.status === "waiting" || t.status === "retrying")) {
      action("pause-all", "Pause all transfers", () => api.pauseAll().catch(report));
    }
    if (transfers.some((t) => t.status === "paused")) action("resume-all", "Resume all transfers", () => api.resumeAll().catch(report));
    if (transfers.length > 0) action("transfers", "Show transfers", () => setDrawerOpen(true));
    for (const [theme, label] of [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as const) {
      if (theme !== settings.theme) action(`theme-${theme}`, `Theme: ${label}`, () => setTheme(theme).catch(report));
    }
    action("settings", "Settings…", () => setSheet({ kind: "settings" }), "⌘,");
    return actions;
  };

  if (connections === null && !connectionsError) return <div className="window" />;
  const noConnections = (connections ?? []).length === 0;
  const addConnection = () => setSheet({ kind: "connection", initial: null });

  const drawer = drawerOpen && (
    <TransferDrawer
      transfers={transfers}
      onPause={(id) => api.pauseTransfer(id).catch(report)}
      onResume={(id) => api.resumeTransfer(id).catch(report)}
      onRetry={(id) => api.retryTransfer(id).catch(report)}
      onCancel={(id) => api.cancelTransfer(id).catch(report)}
      onPauseAll={() => api.pauseAll().catch(report)}
      onResumeAll={() => api.resumeAll().catch(report)}
      onReveal={(path) => api.revealInFinder(path).catch(report)}
      onClearFinished={clearFinished}
      onClose={() => {
        setDrawerOpen(false);
        pill.current?.focus();
      }}
    />
  );

  const errorBanner = actionError && (
    <div className="action-error" role="alert">
      <span>{actionError.message}</span>
      <button type="button" className="link-button" onClick={() => setActionError(null)}>
        Dismiss
      </button>
    </div>
  );

  return (
    <div className={noConnections ? "window no-connections" : "window"}>
      <Rail
        connections={connections ?? []}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={addConnection}
        onContextMenu={connectionMenu}
        onSettings={() => setSheet({ kind: "settings" })}
      />
      {connection ? (
        <Browser
          key={connection.id}
          connection={connection}
          connections={connections ?? []}
          active
          refresh={refresh}
          transfers={transfers}
          drawer={
            <>
              {errorBanner}
              {drawer}
            </>
          }
          pillRef={pill}
          appCommands={appCommands()}
          lastPlaces={lastPlaces.current}
          onSelectConnection={setSelectedId}
          onEditConnection={(profile) => setSheet({ kind: "connection", initial: profile })}
          onOpenTransfers={() => setDrawerOpen(true)}
        />
      ) : (
        <main className="main">
          {connectionsError && <EmptyState tone="error" title="Kelp couldn't load your connections" body={connectionsError.message} />}
          {!connectionsError && noConnections && (
            <EmptyState
              image={<img className="empty-logo" src={mark} alt="" width={64} height={64} />}
              title="Welcome to Kelp"
              body="Add a connection to browse your buckets on Amazon S3, Cloudflare R2 or Hetzner."
              actions={
                <>
                  <button type="button" className="button button-primary" onClick={addConnection}>
                    Add a connection
                  </button>
                  <button type="button" className="link-button" onClick={() => api.openDocs("/docs/")}>
                    Where do I find my keys?
                  </button>
                </>
              }
            />
          )}
          {errorBanner}
          {drawer}
          {transfers.length > 0 && (
            <StatusBar itemCount={null} selectedCount={0} selectedBytes={0} transfers={transfers} onOpenTransfers={() => setDrawerOpen(true)} pillRef={pill} />
          )}
        </main>
      )}
      {sheet.kind === "connection" && (
        <ConnectionSheet
          initial={sheet.initial}
          onCancel={() => setSheet({ kind: "none" })}
          onSaved={async (profile) => {
            setSheet({ kind: "none" });
            await reloadConnections();
            setSelectedId(profile.id);
            setRefresh((n) => n + 1);
          }}
        />
      )}
      {sheet.kind === "settings" && (
        <SettingsSheet theme={settings.theme} onTheme={(theme) => setTheme(theme).catch(report)} onClose={() => setSheet({ kind: "none" })} />
      )}
    </div>
  );
}
