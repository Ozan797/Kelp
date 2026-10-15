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
import { newTabId, useTabs } from "./hooks/useTabs";
import { TabStrip } from "./components/TabStrip";
import type { Place } from "./lib/drop";
import type { Command } from "./lib/palette";
import { api, toAppError, type AppError, type ConnectionProfile } from "./lib/tauri";

type Sheet = { kind: "none" } | { kind: "connection"; initial: ConnectionProfile | null } | { kind: "settings" };

export default function App() {
  const { connections, error: connectionsError, reload: reloadConnections } = useConnections();
  const { transfers, clearFinished } = useTransfers();
  const { settings, setTheme } = useSettings();
  const [{ tabs, activeId }, dispatch] = useTabs();
  const [refresh, setRefresh] = useState({ connectionId: "", count: 0 });
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const lastPlaces = useRef<Record<string, Place>>({});

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const selectedId = activeTab.connectionId;
  const connection = connections?.find((c) => c.id === selectedId) ?? null;
  const setSelectedId = (id: string) => {
    if (id !== activeTab.connectionId) dispatch({ type: "update", id: activeId, patch: { connectionId: id, place: null } });
  };
  const report = (caught: unknown) => setActionError(toAppError(caught));

  useEffect(() => {
    if (!connections) return;
    for (const tab of tabs) {
      if (!connections.some((c) => c.id === tab.connectionId)) {
        dispatch({ type: "update", id: tab.id, patch: { connectionId: connections[0]?.id ?? null, place: null } });
      }
    }
  }, [connections, tabs]);

  useShortcuts(
    {
      "Mod+,": () => setSheet({ kind: "settings" }),
      "Mod+T": () => connection && dispatch({ type: "open", id: newTabId() }),
      "Mod+W": () => dispatch({ type: "close", id: activeId }),
      "Mod+Shift+]": () => dispatch({ type: "next" }),
      "Mod+Shift+[": () => dispatch({ type: "previous" }),
    },
    sheet.kind === "none",
  );

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
    if (connection) action("new-tab", "New tab", () => dispatch({ type: "open", id: newTabId() }), "⌘T");
    if (tabs.length > 1) action("close-tab", "Close tab", () => dispatch({ type: "close", id: activeId }), "⌘W");
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
        tabs.map((tab) => {
          const tabConnection = connections?.find((c) => c.id === tab.connectionId);
          if (!tabConnection) return null;
          const active = tab.id === activeId;
          return (
            <div
              key={`${tab.id}:${tabConnection.id}`}
              id={`tab-panel-${tab.id}`}
              role={tabs.length > 1 ? "tabpanel" : undefined}
              aria-labelledby={tabs.length > 1 ? `tab-${tab.id}` : undefined}
              className="tab-pane"
              hidden={!active}
            >
              <Browser
                connection={tabConnection}
                connections={connections ?? []}
                active={active && sheet.kind === "none"}
                refresh={refresh.connectionId === tabConnection.id ? refresh.count : 0}
                transfers={transfers}
                drawer={
                  active && (
                    <>
                      {errorBanner}
                      {drawer}
                    </>
                  )
                }
                pillRef={active ? pill : null}
                appCommands={appCommands()}
                lastPlaces={lastPlaces.current}
                initialPlace={tab.place}
                strip={
                  <TabStrip
                    tabs={tabs}
                    activeId={activeId}
                    connections={connections ?? []}
                    onSelect={(id) => dispatch({ type: "select", id })}
                    onClose={(id) => dispatch({ type: "close", id })}
                    onNew={() => dispatch({ type: "open", id: newTabId() })}
                  />
                }
                onPlace={(place) => dispatch({ type: "update", id: tab.id, patch: { place } })}
                onSelectConnection={(id) => dispatch({ type: "update", id: tab.id, patch: { connectionId: id, place: null } })}
                onEditConnection={(profile) => setSheet({ kind: "connection", initial: profile })}
                onOpenTransfers={() => setDrawerOpen(true)}
              />
            </div>
          );
        })
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
            setRefresh((current) => ({ connectionId: profile.id, count: current.count + 1 }));
          }}
        />
      )}
      {sheet.kind === "settings" && (
        <SettingsSheet theme={settings.theme} onTheme={(theme) => setTheme(theme).catch(report)} onClose={() => setSheet({ kind: "none" })} />
      )}
    </div>
  );
}
