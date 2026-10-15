import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mark from "../../design/brand/kelp-mark.svg";
import { BucketColumn } from "./components/BucketColumn";
import { ConnectionSheet } from "./components/ConnectionSheet";
import { EmptyState } from "./components/EmptyState";
import { FileList, filterRows, type Sort } from "./components/FileList";
import { NewFolderSheet } from "./components/NewFolderSheet";
import { Rail } from "./components/Rail";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { TransferDrawer } from "./components/TransferDrawer";
import { useConnections } from "./hooks/useConnections";
import { useListing, type Row } from "./hooks/useListing";
import { useTransfers } from "./hooks/useTransfers";
import { useFileDrop } from "./hooks/useFileDrop";
import { useUsage } from "./hooks/useUsage";
import { DropOverlay } from "./components/DropOverlay";
import { destinationText, pillText, summaryText } from "./lib/drop";
import { OverwriteSheet } from "./components/OverwriteSheet";
import { api, toAppError, type AppError, type ConnectionProfile, type FolderPlan, type MenuEntry } from "./lib/tauri";

type Place = { bucket: string; prefix: string };
type Sheet =
  | { kind: "none" }
  | { kind: "connection"; initial: ConnectionProfile | null }
  | { kind: "folder" }
  | { kind: "overwrite"; plan: FolderPlan; paths: string[]; target: Place };

function parentOf(prefix: string): string {
  const parts = prefix.split("/").filter(Boolean).slice(0, -1);
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

const NOTHING_TO_UPLOAD = "Nothing to upload. The folder is empty or everything is already there.";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export default function App() {
  const { connections, error: connectionsError, reload: reloadConnections } = useConnections();
  const { transfers, clearFinished } = useTransfers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [bucketsError, setBucketsError] = useState<AppError | null>(null);
  const [history, setHistory] = useState<Place[]>([]);
  const [position, setPosition] = useState(-1);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", ascending: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [countOnOpen, setCountOnOpen] = useState<Place | null>(null);
  const [checking, setChecking] = useState<Place | null>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const lastPlaces = useRef<Record<string, Place>>({});

  const connection = connections?.find((c) => c.id === selectedId) ?? null;
  const place = position >= 0 ? history[position] : null;
  const listing = useListing(connection?.id ?? null, place?.bucket ?? null, place?.prefix ?? "");
  const size = useUsage(connection?.id ?? null, place?.bucket ?? null, place?.prefix ?? "");
  const startSize = size.start;

  useEffect(() => {
    if (!countOnOpen || countOnOpen.bucket !== place?.bucket || countOnOpen.prefix !== place.prefix) return;
    setCountOnOpen(null);
    startSize().catch((caught) => setActionError(toAppError(caught)));
  }, [countOnOpen, place?.bucket, place?.prefix, startSize]);

  const selectConnection = (id: string) => {
    if (id === selectedId) return;
    if (connection && place) api.setLastLocation(connection.id, place).catch(() => undefined);
    setSelectedId(id);
    setHistory([]);
    setPosition(-1);
    setBuckets(null);
    setBucketsError(null);
  };

  useEffect(() => {
    if (connections && connections.length > 0 && !connections.some((c) => c.id === selectedId)) {
      setSelectedId(connections[0].id);
    }
  }, [connections, selectedId]);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    setBuckets(null);
    setBucketsError(null);
    setHistory([]);
    setPosition(-1);
    api
      .listBuckets(connection.id)
      .then((list) => {
        if (cancelled) return;
        setBuckets(list);
        const last = lastPlaces.current[connection.id] ?? connection.lastLocation;
        const start = last && list.includes(last.bucket) ? last : list.length === 1 ? { bucket: list[0], prefix: "" } : null;
        if (start) {
          setHistory([start]);
          setPosition(0);
        }
      })
      .catch((caught) => {
        if (!cancelled) setBucketsError(toAppError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.id, refresh]);

  useEffect(() => {
    if (!connection || !place) return;
    lastPlaces.current[connection.id] = place;
    const timer = setTimeout(() => {
      api.setLastLocation(connection.id, place).catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [connection?.id, place?.bucket, place?.prefix]);

  const finishedUploads = transfers.filter((t) => t.direction === "upload" && t.status === "finished").length;
  const seenUploads = useRef(finishedUploads);
  useEffect(() => {
    if (finishedUploads > seenUploads.current) listing.reload();
    seenUploads.current = finishedUploads;
  }, [finishedUploads, listing.reload]);

  const go = useCallback(
    (next: Place) => {
      setHistory((current) => [...current.slice(0, position + 1), next]);
      setPosition((current) => current + 1);
      setSelected(new Set());
      setFilter("");
    },
    [position],
  );

  const step = (delta: number) => {
    setPosition((p) => p + delta);
    setSelected(new Set());
    setFilter("");
  };

  const up = useCallback(() => {
    if (place && place.prefix) go({ bucket: place.bucket, prefix: parentOf(place.prefix) });
  }, [place, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (sheet.kind !== "none" || typing || event.defaultPrevented) return;
      if (event.key === "Backspace" || (event.metaKey && event.key === "ArrowUp")) {
        event.preventDefault();
        up();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet.kind, up]);

  const visibleRows = useMemo(() => filterRows(listing.rows, filter), [listing.rows, filter]);
  const selectedRows = useMemo(() => visibleRows.filter((r) => selected.has(r.key)), [visibleRows, selected]);
  const selectedBytes = selectedRows.reduce((sum, r) => sum + (r.size ?? 0), 0);

  const download = async (rows: Row[]) => {
    if (!connection || !place) return;
    for (const row of rows) {
      try {
        if (row.isFolder) await api.startFolderDownload(connection.id, place.bucket, row.key);
        else await api.startDownload(connection.id, place.bucket, row.key, row.size ?? 0);
        setDrawerOpen(true);
      } catch (caught) {
        setActionError(toAppError(caught));
      }
    }
  };

  const remove = async (rows: Row[]) => {
    if (!connection || !place || rows.length === 0) return;
    const label = rows.length === 1 ? `Delete ${rows[0].name}` : `Delete ${plural(rows.length, "item")}`;
    const folders = rows.some((r) => r.isFolder) ? " Folders are deleted with everything inside them." : "";
    const confirmed = await api.confirm(`${label}?${folders} This can't be undone.`, label);
    if (!confirmed) return;
    try {
      await api.deleteObjects(
        connection.id,
        place.bucket,
        rows.map((r) => r.key),
      );
      setSelected(new Set());
    } catch (caught) {
      setActionError(toAppError(caught));
    } finally {
      listing.reload();
    }
  };

  const uploadPaths = async (paths: string[], target: Place) => {
    if (!connection || paths.length === 0) return;
    setChecking(target);
    try {
      const plan = await api.planUpload(connection.id, target.bucket, target.prefix, paths);
      if (plan.existing > 0) setSheet({ kind: "overwrite", plan, paths, target });
      else await startUploads(paths, target, false);
    } catch (caught) {
      setActionError(toAppError(caught));
    } finally {
      setChecking(null);
    }
  };

  const startUploads = async (paths: string[], target: Place, skipExisting: boolean) => {
    if (!connection) return;
    try {
      const started = await api.startUploads(connection.id, target.bucket, target.prefix, paths, skipExisting);
      if (started.length > 0) setDrawerOpen(true);
      else setActionError({ kind: "io", message: NOTHING_TO_UPLOAD });
    } catch (caught) {
      setActionError(toAppError(caught));
    }
  };

  const upload = async () => {
    if (place) await uploadPaths(await api.pickFiles(), place);
  };

  const uploadFolder = async () => {
    if (!place) return;
    const path = await api.pickFolder();
    if (path) await uploadPaths([path], place);
  };

  const drag = useFileDrop(place, (paths, target) => {
    if (sheet.kind === "none") uploadPaths(paths, target);
  });

  const chooseUpload = () => {
    api
      .showContextMenu([
        { label: "Upload files…", onSelect: upload },
        { label: "Upload a folder…", onSelect: uploadFolder },
      ])
      .catch(() => undefined);
  };

  const calculateSize = (target: Place) => {
    go(target);
    setCountOnOpen(target);
  };

  const bucketMenu = (bucket: string) => {
    api
      .showContextMenu([
        {
          label: "Calculate size",
          onSelect: () => calculateSize({ bucket, prefix: "" }),
        },
      ])
      .catch(() => undefined);
  };

  const openRow = (row: Row) => {
    if (place && row.isFolder) go({ bucket: place.bucket, prefix: row.key });
  };

  const fileMenu = (row: Row, keys: Set<string>) => {
    const rows = visibleRows.filter((r) => keys.has(r.key));
    const onlyFiles = rows.every((r) => !r.isFolder);
    const entries: MenuEntry[] = [];
    if (rows.length === 1 && row.isFolder) {
      entries.push({ label: "Open", onSelect: () => openRow(row) });
      entries.push({
        label: "Calculate size",
        onSelect: () => {
          if (place) calculateSize({ bucket: place.bucket, prefix: row.key });
        },
      });
    }
    if (rows.length > 0) {
      entries.push({
        label: rows.length === 1 ? `Download ${rows[0].name}` : `Download ${plural(rows.length, onlyFiles ? "file" : "item")}`,
        onSelect: () => download(rows),
      });
    }
    if (entries.length > 0) entries.push("separator");
    entries.push({
      label: rows.length === 1 ? `Delete ${rows[0].name}…` : `Delete ${plural(rows.length, "item")}…`,
      onSelect: () => remove(rows),
    });
    api.showContextMenu(entries).catch(() => undefined);
  };

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
              setActionError(toAppError(caught));
            }
          },
        },
      ])
      .catch(() => undefined);
  };

  const checkingText = checking ? `Checking what's already in ${destinationText(checking)}…` : "";
  const liveText = checking ? checkingText : drag ? pillText(summaryText(drag.summary, drag.paths.length), drag.target) : "";
  const checkingPill = (
    <div className="drop-pill" aria-hidden="true">
      {checkingText}
    </div>
  );

  if (connections === null && !connectionsError) return <div className="window" />;
  const noConnections = (connections ?? []).length === 0;
  const addConnection = () => setSheet({ kind: "connection", initial: null });
  const retryBuckets = () => setRefresh((n) => n + 1);

  const failure = (error: AppError, title: string, retry: () => void) => {
    const tryAgain = (
      <button type="button" className="button button-primary" onClick={retry}>
        Try again
      </button>
    );
    if (error.kind !== "badCredentials" || !connection) {
      return <EmptyState tone="error" title={title} body={error.message} actions={tryAgain} />;
    }
    return (
      <EmptyState
        tone="error"
        title="This connection's keys no longer work"
        body="They may have been changed or revoked at your provider."
        actions={
          <>
            <button type="button" className="button button-secondary" onClick={() => setSheet({ kind: "connection", initial: connection })}>
              Update keys
            </button>
            {tryAgain}
          </>
        }
      />
    );
  };

  const content = () => {
    if (!connection || !place) return null;
    if (listing.error) return failure(listing.error, "Kelp couldn't open this folder", listing.reload);
    if (listing.loading && listing.rows.length === 0) {
      return (
        <div className="skeleton-rows" aria-label="Loading files">
          {[55, 38, 62, 45, 50, 40].map((width) => (
            <span key={width} className="skeleton" style={{ width: `${width}%` }} />
          ))}
        </div>
      );
    }
    if (listing.rows.length === 0) {
      return (
        <EmptyState
          title="This folder is empty"
          body="Choose Upload to add files."
          actions={
            <button type="button" className="button button-primary" onClick={upload}>
              Upload files
            </button>
          }
        />
      );
    }
    return (
      <FileList
        key={`${connection.id}/${place.bucket}/${place.prefix}`}
        rows={listing.rows}
        filter={filter}
        sort={sort}
        onSort={setSort}
        selected={selected}
        onSelectionChange={setSelected}
        onOpen={openRow}
        onGoUp={up}
        onContextMenu={fileMenu}
        hasMore={listing.hasMore}
        loading={listing.loading}
        onLoadMore={listing.loadMore}
        dropKey={drag?.zone === "folder" && drag.target?.bucket === place.bucket ? drag.target.prefix : null}
      />
    );
  };

  return (
    <div className={noConnections ? "window no-connections" : "window"}>
      <Rail connections={connections ?? []} selectedId={selectedId} onSelect={selectConnection} onAdd={addConnection} onContextMenu={connectionMenu} />
      {connection && (
        <BucketColumn
          connection={connection}
          buckets={buckets}
          error={bucketsError}
          selected={place?.bucket ?? null}
          onSelect={(bucket) => go({ bucket, prefix: "" })}
          onContextMenu={bucketMenu}
          dropBucket={drag?.zone === "bucket" ? (drag.target?.bucket ?? null) : null}
        />
      )}
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
        {connection && !place && bucketsError && failure(bucketsError, "Kelp couldn't load the buckets", retryBuckets)}
        {connection && !place && !bucketsError && (
          <EmptyState
            title="Choose a bucket"
            body={
              connection.lastLocation && buckets && !buckets.includes(connection.lastLocation.bucket)
                ? `The bucket "${connection.lastLocation.bucket}" you had open is gone. Choose another one.`
                : "Pick a bucket on the left to see its files."
            }
          />
        )}
        {connection && place && (
          <>
            <Toolbar
              bucket={place.bucket}
              prefix={place.prefix}
              canBack={position > 0}
              canForward={position < history.length - 1}
              onBack={() => step(-1)}
              onForward={() => step(1)}
              onNavigate={(prefix) => go({ bucket: place.bucket, prefix })}
              filter={filter}
              onFilter={setFilter}
              onNewFolder={() => setSheet({ kind: "folder" })}
              onUpload={chooseUpload}
            />
            <div className="drop-area" data-drop="list">
              {content()}
              {drag && <DropOverlay drag={drag} open={place} />}
              {checking && checkingPill}
            </div>
          </>
        )}
        {drag && !place && <DropOverlay drag={drag} open={null} />}
        {checking && !place && checkingPill}
        <p className="visually-hidden" role="status">
          {liveText}
        </p>
        {actionError && (
          <div className="action-error" role="alert">
            <span>{actionError.message}</span>
            <button type="button" className="link-button" onClick={() => setActionError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {drawerOpen && (
          <TransferDrawer
            transfers={transfers}
            onPause={(id) => api.pauseTransfer(id).catch((e) => setActionError(toAppError(e)))}
            onResume={(id) => api.resumeTransfer(id).catch((e) => setActionError(toAppError(e)))}
            onRetry={(id) => api.retryTransfer(id).catch((e) => setActionError(toAppError(e)))}
            onCancel={(id) => api.cancelTransfer(id).catch((e) => setActionError(toAppError(e)))}
            onPauseAll={() => api.pauseAll().catch((e) => setActionError(toAppError(e)))}
            onResumeAll={() => api.resumeAll().catch((e) => setActionError(toAppError(e)))}
            onReveal={(path) => api.revealInFinder(path).catch((e) => setActionError(toAppError(e)))}
            onClearFinished={clearFinished}
            onClose={() => {
              setDrawerOpen(false);
              pill.current?.focus();
            }}
          />
        )}
        {(connection || transfers.length > 0) && (
          <StatusBar
            itemCount={place ? listing.rows.length : null}
            selectedCount={place ? selectedRows.length : 0}
            selectedBytes={selectedBytes}
            transfers={transfers}
            onOpenTransfers={() => setDrawerOpen(true)}
            pillRef={pill}
            size={
              place
                ? {
                    usage: size.usage,
                    now: Date.now(),
                    onCalculate: () => size.start().catch((e) => setActionError(toAppError(e))),
                    onCancel: () => size.cancel().catch((e) => setActionError(toAppError(e))),
                  }
                : null
            }
          />
        )}
      </main>
      {sheet.kind === "connection" && (
        <ConnectionSheet
          initial={sheet.initial}
          onCancel={() => setSheet({ kind: "none" })}
          onSaved={async (profile) => {
            setSheet({ kind: "none" });
            await reloadConnections();
            selectConnection(profile.id);
            setRefresh((n) => n + 1);
          }}
        />
      )}
      {sheet.kind === "overwrite" && (
        <OverwriteSheet
          plan={sheet.plan}
          what={sheet.paths.length === 1 ? `"${sheet.paths[0].split("/").filter(Boolean).pop() ?? sheet.paths[0]}"` : `${sheet.paths.length} items`}
          destination={`${sheet.target.bucket}/${sheet.target.prefix}`}
          onCancel={() => setSheet({ kind: "none" })}
          onSkip={() => {
            setSheet({ kind: "none" });
            startUploads(sheet.paths, sheet.target, true);
          }}
          onReplace={() => {
            setSheet({ kind: "none" });
            startUploads(sheet.paths, sheet.target, false);
          }}
        />
      )}
      {sheet.kind === "folder" && connection && place && (
        <NewFolderSheet
          onCancel={() => setSheet({ kind: "none" })}
          onCreate={async (name) => {
            await api.createFolder(connection.id, place.bucket, place.prefix, name);
            setSheet({ kind: "none" });
            listing.reload();
          }}
        />
      )}
    </div>
  );
}
