import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { BucketColumn } from "./components/BucketColumn";
import { CommandPalette } from "./components/CommandPalette";
import { DropOverlay } from "./components/DropOverlay";
import { EmptyState } from "./components/EmptyState";
import { FileList, filterRows, sortRows, type Sort } from "./components/FileList";
import { NewFolderSheet } from "./components/NewFolderSheet";
import { OverwriteSheet } from "./components/OverwriteSheet";
import { Preview } from "./components/Preview";
import { PROVIDER_NAMES } from "./components/Rail";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { useFileDrop } from "./hooks/useFileDrop";
import { useListing, type Row } from "./hooks/useListing";
import { useShortcuts } from "./hooks/useShortcuts";
import type { Transfer } from "./hooks/useTransfers";
import { useUsage } from "./hooks/useUsage";
import { destinationText, pillText, summaryText, type Place } from "./lib/drop";
import type { Command } from "./lib/palette";
import { CopySheet } from "./components/CopySheet";
import { DragGhost } from "./components/DragGhost";
import { MoveSheet } from "./components/MoveSheet";
import { useRowDrag } from "./hooks/useRowDrag";
import { api, toAppError, type AppError, type ConnectionProfile, type CopyRequest, type FolderPlan, type MenuEntry } from "./lib/tauri";

type Sheet =
  | { kind: "none" }
  | { kind: "folder" }
  | { kind: "palette" }
  | { kind: "preview"; key: string }
  | { kind: "overwrite"; plan: FolderPlan; what: string; destination: string; verb: string; start: (skipExisting: boolean) => void }
  | { kind: "move"; plan: FolderPlan; count: number; destination: string; from: string; start: () => void }
  | { kind: "copyTo"; target: ConnectionProfile; keys: string[] };

function parentOf(prefix: string): string {
  const parts = prefix.split("/").filter(Boolean).slice(0, -1);
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

const NOTHING_TO_COPY = "Nothing to copy. Everything is already there.";
const NOTHING_TO_UPLOAD = "Nothing to upload. The folder is empty or everything is already there.";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export type BrowserProps = {
  connection: ConnectionProfile;
  connections: ConnectionProfile[];
  active: boolean;
  refresh: number;
  transfers: Transfer[];
  drawer: ReactNode;
  pillRef: Ref<HTMLButtonElement>;
  appCommands: Command[];
  lastPlaces: Record<string, Place>;
  initialPlace: Place | null;
  strip: ReactNode;
  onPlace: (place: Place | null) => void;
  onSelectConnection: (id: string) => void;
  onEditConnection: (profile: ConnectionProfile) => void;
  onOpenTransfers: () => void;
  onDragConnection: (id: string | null) => void;
};

export function Browser({
  connection,
  connections,
  active,
  refresh,
  transfers,
  drawer,
  pillRef,
  appCommands,
  lastPlaces,
  initialPlace,
  strip,
  onPlace,
  onSelectConnection,
  onEditConnection,
  onOpenTransfers,
  onDragConnection,
}: BrowserProps) {
  const [reload, setReload] = useState(0);
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [bucketsError, setBucketsError] = useState<AppError | null>(null);
  const [history, setHistory] = useState<Place[]>([]);
  const [position, setPosition] = useState(-1);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", ascending: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [countOnOpen, setCountOnOpen] = useState<Place | null>(null);
  const [checking, setChecking] = useState<Place | null>(null);

  const place = position >= 0 ? history[position] : null;
  const listing = useListing(connection.id, place?.bucket ?? null, place?.prefix ?? "");
  const size = useUsage(connection.id, place?.bucket ?? null, place?.prefix ?? "");
  const startSize = size.start;

  const opening = useRef(initialPlace);
  useEffect(() => {
    onPlace(place);
  }, [place?.bucket, place?.prefix]);

  const latestPlace = useRef(place);
  latestPlace.current = place;
  useEffect(
    () => () => {
      if (latestPlace.current) api.setLastLocation(connection.id, latestPlace.current).catch(() => undefined);
    },
    [connection.id],
  );

  useEffect(() => {
    if (!countOnOpen || countOnOpen.bucket !== place?.bucket || countOnOpen.prefix !== place.prefix) return;
    setCountOnOpen(null);
    startSize().catch((caught) => setActionError(toAppError(caught)));
  }, [countOnOpen, place?.bucket, place?.prefix, startSize]);

  useEffect(() => {
    let cancelled = false;
    const keep = latestPlace.current;
    setBuckets(null);
    setBucketsError(null);
    setHistory([]);
    setPosition(-1);
    api
      .listBuckets(connection.id)
      .then((list) => {
        if (cancelled) return;
        setBuckets(list);
        const last = opening.current ?? keep ?? lastPlaces[connection.id] ?? connection.lastLocation;
        opening.current = null;
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
  }, [connection.id, refresh, reload]);

  useEffect(() => {
    if (!place) return;
    lastPlaces[connection.id] = place;
    const timer = setTimeout(() => {
      api.setLastLocation(connection.id, place).catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [connection.id, place?.bucket, place?.prefix]);

  const finishedUploads = transfers.filter((t) => t.direction !== "download" && t.status === "finished").length;
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

  const up = () => {
    if (place && place.prefix) go({ bucket: place.bucket, prefix: parentOf(place.prefix) });
  };

  const visibleRows = useMemo(() => filterRows(listing.rows, filter), [listing.rows, filter]);
  const selectedRows = useMemo(() => visibleRows.filter((r) => selected.has(r.key)), [visibleRows, selected]);
  const previewFiles = useMemo(() => sortRows(visibleRows, sort).filter((r) => !r.isFolder), [visibleRows, sort]);
  const previewStart = previewFiles.findIndex((r) => selected.has(r.key));
  const previewIndex = sheet.kind === "preview" ? previewFiles.findIndex((r) => r.key === sheet.key) : -1;
  useEffect(() => {
    if (sheet.kind === "preview" && previewIndex < 0 && !listing.loading) setSheet({ kind: "none" });
  }, [sheet.kind, previewIndex, listing.loading]);
  const selectedBytes = selectedRows.reduce((sum, r) => sum + (r.size ?? 0), 0);

  const download = async (rows: Row[]) => {
    if (!place) return;
    for (const row of rows) {
      try {
        if (row.isFolder) await api.startFolderDownload(connection.id, place.bucket, row.key);
        else await api.startDownload(connection.id, place.bucket, row.key, row.size ?? 0);
        onOpenTransfers();
      } catch (caught) {
        setActionError(toAppError(caught));
      }
    }
  };

  const remove = async (rows: Row[]) => {
    if (!place || rows.length === 0) return;
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

  const startUploads = async (paths: string[], target: Place, skipExisting: boolean) => {
    try {
      const started = await api.startUploads(connection.id, target.bucket, target.prefix, paths, skipExisting);
      if (started.length > 0) onOpenTransfers();
      else setActionError({ kind: "io", message: NOTHING_TO_UPLOAD });
    } catch (caught) {
      setActionError(toAppError(caught));
    }
  };

  const uploadPaths = async (paths: string[], target: Place) => {
    if (paths.length === 0) return;
    setChecking(target);
    try {
      const plan = await api.planUpload(connection.id, target.bucket, target.prefix, paths);
      if (plan.existing > 0) {
        setSheet({
          kind: "overwrite",
          plan,
          what: paths.length === 1 ? `"${paths[0].split("/").filter(Boolean).pop() ?? paths[0]}"` : `${paths.length} items`,
          destination: `${target.bucket}/${target.prefix}`,
          verb: "Uploading",
          start: (skip) => startUploads(paths, target, skip),
        });
      }
      else await startUploads(paths, target, false);
    } catch (caught) {
      setActionError(toAppError(caught));
    } finally {
      setChecking(null);
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

  const drag = useFileDrop(
    place,
    (paths, target) => {
      if (sheet.kind === "none" && !checking) uploadPaths(paths, target);
    },
    active,
  );

  const startCopy = async (request: CopyRequest, skipExisting: boolean, moving: boolean) => {
    try {
      const started = await api.startCopy(request, skipExisting, moving);
      if (started.length > 0) onOpenTransfers();
      else setActionError({ kind: "io", message: NOTHING_TO_COPY });
    } catch (caught) {
      setActionError(toAppError(caught));
    }
  };

  const copyOrMove = async (request: CopyRequest, moving: boolean) => {
    if (!place) return;
    try {
      const plan = await api.planCopy(request);
      const count = request.keys.length;
      const destination = destinationText({ bucket: request.toBucket, prefix: request.prefix });
      if (plan.existing > 0) {
        const first = request.keys[0].split("/").filter(Boolean).pop() ?? request.keys[0];
        setSheet({
          kind: "overwrite",
          plan,
          what: count === 1 ? `"${first}"` : `${count} items`,
          destination: `${request.toBucket}/${request.prefix}`,
          verb: moving ? "Moving" : "Copying",
          start: (skip) => startCopy(request, skip, moving),
        });
      } else if (moving) {
        setSheet({ kind: "move", plan, count, destination, from: destinationText(place), start: () => startCopy(request, false, true) });
      } else {
        await startCopy(request, false, false);
      }
    } catch (caught) {
      setActionError(toAppError(caught));
    }
  };

  const rowDrag = useRowDrag({
    open: place,
    connectionId: connection.id,
    onDrop: (keys, target, copy) => {
      if (!place || sheet.kind !== "none") return;
      if (target.kind === "connection") {
        const other = connections.find((c) => c.id === target.connectionId);
        if (other) setSheet({ kind: "copyTo", target: other, keys });
        return;
      }
      const request = { from: connection.id, fromBucket: place.bucket, keys, to: connection.id, toBucket: target.place.bucket, prefix: target.place.prefix };
      copyOrMove(request, !copy);
    },
  });
  const rowTarget = rowDrag.drag?.target ?? null;
  const rowPlace = rowTarget?.kind === "place" ? rowTarget.place : null;
  const dragConnection = rowTarget?.kind === "connection" ? rowTarget.connectionId : null;
  useEffect(() => {
    onDragConnection(dragConnection);
  }, [dragConnection]);

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
      .showContextMenu([{ label: "Calculate size", onSelect: () => calculateSize({ bucket, prefix: "" }) }])
      .catch(() => undefined);
  };

  const preview = (row: Row) => setSheet({ kind: "preview", key: row.key });

  const reloadHere = () => {
    if (place) listing.reload();
    else setReload((n) => n + 1);
  };

  const openRow = (row: Row) => {
    if (place && row.isFolder) go({ bucket: place.bucket, prefix: row.key });
  };

  const downloadLabel = (rows: Row[]) =>
    rows.length === 1 ? `Download ${rows[0].name}` : `Download ${plural(rows.length, rows.every((r) => !r.isFolder) ? "file" : "item")}`;

  const fileMenu = (row: Row, keys: Set<string>) => {
    const rows = visibleRows.filter((r) => keys.has(r.key));
    const entries: MenuEntry[] = [];
    if (rows.length === 1 && !row.isFolder) entries.push({ label: "Preview", onSelect: () => preview(row) });
    if (rows.length === 1 && row.isFolder) {
      entries.push({ label: "Open", onSelect: () => openRow(row) });
      entries.push({
        label: "Calculate size",
        onSelect: () => {
          if (place) calculateSize({ bucket: place.bucket, prefix: row.key });
        },
      });
    }
    if (rows.length > 0) entries.push({ label: downloadLabel(rows), onSelect: () => download(rows) });
    if (entries.length > 0) entries.push("separator");
    entries.push({
      label: rows.length === 1 ? `Delete ${rows[0].name}…` : `Delete ${plural(rows.length, "item")}…`,
      onSelect: () => remove(rows),
    });
    api.showContextMenu(entries).catch(() => undefined);
  };

  useShortcuts(
    {
      "Mod+K": () => setSheet({ kind: "palette" }),
      "Mod+Shift+N": () => place && setSheet({ kind: "folder" }),
      "Mod+D": () => selectedRows.length > 0 && download(selectedRows),
      Space: () => previewStart >= 0 && setSheet({ kind: "preview", key: previewFiles[previewStart].key }),
      Backspace: up,
      "Mod+R": reloadHere,
      "Mod+ArrowUp": up,
    },
    active && sheet.kind === "none",
  );

  const paletteCommands = (): Command[] => {
    const places: Command[] = [];
    if (place) {
      for (const row of listing.rows.filter((r) => r.isFolder)) {
        places.push({ id: `folder:${row.key}`, label: row.name, detail: `${place.bucket}/${place.prefix}`, group: "places", run: () => go({ bucket: place.bucket, prefix: row.key }) });
      }
    }
    for (const bucket of buckets ?? []) {
      places.push({ id: `bucket:${bucket}`, label: bucket, detail: "Bucket", group: "places", run: () => go({ bucket, prefix: "" }) });
    }
    for (const other of connections) {
      if (other.id === connection.id) continue;
      places.push({
        id: `connection:${other.id}`,
        label: `${PROVIDER_NAMES[other.settings.kind]} · ${other.name}`,
        detail: "Connection",
        group: "places",
        run: () => onSelectConnection(other.id),
      });
    }
    const actions: Command[] = [];
    const action = (id: string, label: string, run: () => void, shortcut?: string) => actions.push({ id, label, run, shortcut, group: "actions" });
    if (place) {
      action("upload-files", "Upload files…", upload);
      action("upload-folder", "Upload a folder…", uploadFolder);
      action("new-folder", "New folder…", () => setSheet({ kind: "folder" }), "⌘⇧N");
      if (selectedRows.length > 0) action("download", downloadLabel(selectedRows), () => download(selectedRows), "⌘D");
      action("size", "Calculate size", () => calculateSize(place));
      action("refresh", "Refresh", reloadHere, "⌘R");
      if (previewStart >= 0) {
        action("preview", `Preview ${previewFiles[previewStart].name}`, () => setSheet({ kind: "preview", key: previewFiles[previewStart].key }), "Space");
      }
    }
    return [...actions, ...appCommands, ...places];
  };

  const checkingText = checking ? `Checking what's already in ${destinationText(checking)}…` : "";
  const liveText = checking ? checkingText : drag ? pillText(summaryText(drag.summary, drag.paths.length), drag.target) : "";
  const checkingPill = (
    <div className="drop-pill" aria-hidden="true">
      {checkingText}
    </div>
  );

  const failure = (error: AppError, title: string, retry: () => void) => {
    const tryAgain = (
      <button type="button" className="button button-primary" onClick={retry}>
        Try again
      </button>
    );
    if (error.kind !== "badCredentials") {
      return <EmptyState tone="error" title={title} body={error.message} actions={tryAgain} />;
    }
    return (
      <EmptyState
        tone="error"
        title="This connection's keys no longer work"
        body="They may have been changed or revoked at your provider."
        actions={
          <>
            <button type="button" className="button button-secondary" onClick={() => onEditConnection(connection)}>
              Update keys
            </button>
            {tryAgain}
          </>
        }
      />
    );
  };

  const content = () => {
    if (!place) return null;
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
        initialScrollTop={listing.restore?.scrollTop ?? null}
        onScrollTopChange={listing.rememberScroll}
        dropKey={
          drag?.zone === "folder" && drag.target?.bucket === place.bucket
            ? drag.target.prefix
            : rowPlace?.bucket === place.bucket
              ? rowPlace.prefix
              : null
        }
        onPreview={preview}
        onRowPointerDown={(row, x, y) => {
          if (!active) return;
          const keys = selected.has(row.key) ? selectedRows.map((r) => r.key) : [row.key];
          if (!selected.has(row.key)) setSelected(new Set([row.key]));
          rowDrag.begin(keys, x, y);
        }}
      />
    );
  };

  return (
    <>
      <BucketColumn
        connection={connection}
        buckets={buckets}
        error={bucketsError}
        selected={place?.bucket ?? null}
        onSelect={(bucket) => go({ bucket, prefix: "" })}
        onContextMenu={bucketMenu}
        dropBucket={
          drag?.zone === "bucket"
            ? (drag.target?.bucket ?? null)
            : rowPlace && rowPlace.prefix === "" && rowPlace.bucket !== place?.bucket
              ? rowPlace.bucket
              : null
        }
      />
      <main className="main">
        {strip}
        {!place && bucketsError && failure(bucketsError, "Kelp couldn't load the buckets", () => setReload((n) => n + 1))}
        {!place && !bucketsError && (
          <EmptyState
            title="Choose a bucket"
            body={
              connection.lastLocation && buckets && !buckets.includes(connection.lastLocation.bucket)
                ? `The bucket "${connection.lastLocation.bucket}" you had open is gone. Choose another one.`
                : "Pick a bucket on the left to see its files."
            }
          />
        )}
        {place && (
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
              onRefresh={reloadHere}
              onUpload={chooseUpload}
              dropKey={rowPlace?.bucket === place.bucket ? rowPlace.prefix : null}
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
        {drawer}
        <StatusBar
          itemCount={place ? listing.rows.length : null}
          selectedCount={place ? selectedRows.length : 0}
          selectedBytes={selectedBytes}
          transfers={transfers}
          onOpenTransfers={onOpenTransfers}
          pillRef={pillRef}
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
      </main>
      {sheet.kind === "overwrite" && (
        <OverwriteSheet
          plan={sheet.plan}
          what={sheet.what}
          verb={sheet.verb}
          destination={sheet.destination}
          onCancel={() => setSheet({ kind: "none" })}
          onSkip={() => {
            setSheet({ kind: "none" });
            sheet.start(true);
          }}
          onReplace={() => {
            setSheet({ kind: "none" });
            sheet.start(false);
          }}
        />
      )}
      {sheet.kind === "move" && (
        <MoveSheet
          count={sheet.count}
          plan={sheet.plan}
          destination={sheet.destination}
          from={sheet.from}
          onCancel={() => setSheet({ kind: "none" })}
          onMove={() => {
            setSheet({ kind: "none" });
            sheet.start();
          }}
        />
      )}
      {sheet.kind === "copyTo" && place && (
        <CopySheet
          connection={sheet.target}
          names={sheet.keys.map((key) => key.split("/").filter(Boolean).pop() ?? key)}
          onCancel={() => setSheet({ kind: "none" })}
          onCopy={(bucket, prefix) => {
            const keys = sheet.keys;
            const to = sheet.target.id;
            setSheet({ kind: "none" });
            copyOrMove({ from: connection.id, fromBucket: place.bucket, keys, to, toBucket: bucket, prefix }, false);
          }}
        />
      )}
      {rowDrag.drag && <DragGhost drag={rowDrag.drag} />}
      {sheet.kind === "preview" && previewIndex >= 0 && place && (
        <Preview
          connectionId={connection.id}
          bucket={place.bucket}
          files={previewFiles}
          index={previewIndex}
          onIndex={(index) => setSheet({ kind: "preview", key: previewFiles[index].key })}
          onClose={() => setSheet({ kind: "none" })}
          onDownload={(row) => download([row])}
        />
      )}
      {sheet.kind === "palette" && <CommandPalette commands={paletteCommands()} onClose={() => setSheet({ kind: "none" })} />}
      {sheet.kind === "folder" && place && (
        <NewFolderSheet
          onCancel={() => setSheet({ kind: "none" })}
          onCreate={async (name) => {
            await api.createFolder(connection.id, place.bucket, place.prefix, name);
            setSheet({ kind: "none" });
            listing.reload();
          }}
        />
      )}
    </>
  );
}
