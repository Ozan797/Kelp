import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { Row } from "../hooks/useListing";
import { fileKind, formatBytes, formatModified, type FileKind } from "../lib/format";

export type SortKey = "name" | "size" | "modified";
export type Sort = { key: SortKey; ascending: boolean };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: Row, b: Row, key: SortKey): number {
  if (key === "size") return (a.size ?? 0) - (b.size ?? 0);
  if (key === "modified") return (a.lastModified ?? "").localeCompare(b.lastModified ?? "");
  return collator.compare(a.name, b.name);
}

export function sortRows(rows: Row[], sort: Sort): Row[] {
  const direction = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const byKey = compare(a, b, sort.key) * direction;
    return byKey !== 0 ? byKey : collator.compare(a.name, b.name);
  });
}

export function filterRows(rows: Row[], text: string): Row[] {
  const needle = text.trim().toLowerCase();
  return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
}

export function nextSelection(
  selected: Set<string>,
  ordered: string[],
  key: string,
  mode: "replace" | "toggle" | "range",
  anchor: string | null,
): Set<string> {
  if (mode === "toggle") {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }
  if (mode === "range" && anchor !== null) {
    const from = ordered.indexOf(anchor);
    const to = ordered.indexOf(key);
    if (from !== -1 && to !== -1) {
      const [start, end] = from < to ? [from, to] : [to, from];
      return new Set(ordered.slice(start, end + 1));
    }
  }
  return new Set([key]);
}

const ICONS: Record<FileKind, string> = {
  folder: "M2 5.5A1.5 1.5 0 0 1 3.5 4h3.6c.4 0 .8.2 1.1.5L9.3 6h7.2A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z",
  video: "M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14V6A1.5 1.5 0 0 1 4 4.5zm4.5 3v5l4-2.5z",
  image: "M4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 4zm.5 10h11l-3.5-4-2.5 3-2-2z",
  text: "M5 2.5h6.2L15 6.3v10.2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM6.5 10h7v1.2h-7zm0 2.5h7v1.2h-7z",
  other: "M5 2.5h6.2L15 6.3v10.2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z",
};

function FileIcon({ kind }: { kind: FileKind }) {
  return (
    <svg className={`file-icon ${kind}`} viewBox="0 0 20 20" aria-hidden="true">
      <path d={ICONS[kind]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

const INTRO_ROWS = 12;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "modified", label: "Modified" },
];

type FileListProps = {
  rows: Row[];
  filter: string;
  sort: Sort;
  onSort: (sort: Sort) => void;
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onOpen: (row: Row) => void;
  onGoUp: () => void;
  onContextMenu: (row: Row, keys: Set<string>) => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
};

export function FileList(props: FileListProps) {
  const { rows, filter, sort, onSort, selected, onSelectionChange, onOpen, onGoUp, onContextMenu, hasMore, loading, onLoadMore } = props;
  const visible = useMemo(() => sortRows(filterRows(rows, filter), sort), [rows, filter, sort]);
  const ordered = useMemo(() => visible.map((row) => row.key), [visible]);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [firstPage] = useState(visible);
  const [scrolled, setScrolled] = useState(false);
  const introducing = !scrolled && visible === firstPage;

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 28,
    overscan: 12,
    initialRect: { width: 800, height: 600 },
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (hasMore && !loading && lastIndex >= visible.length - 20) onLoadMore();
  }, [hasMore, loading, lastIndex, visible.length, onLoadMore]);

  const choose = (key: string, mode: "replace" | "toggle" | "range") => {
    onSelectionChange(nextSelection(selected, ordered, key, mode, anchor.current));
    if (mode !== "range") anchor.current = key;
  };

  const click = (row: Row, index: number, event: MouseEvent) => {
    setFocusIndex(index);
    choose(row.key, event.shiftKey ? "range" : event.metaKey ? "toggle" : "replace");
  };

  const keyDown = (event: KeyboardEvent) => {
    const goUp = event.key === "Backspace" || (event.key === "ArrowUp" && event.metaKey);
    if (goUp) {
      event.preventDefault();
      onGoUp();
    } else if (visible.length === 0) {
      return;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(Math.max(focusIndex + (event.key === "ArrowDown" ? 1 : -1), 0), visible.length - 1);
      setFocusIndex(next);
      virtualizer.scrollToIndex(next);
      choose(visible[next].key, event.shiftKey ? "range" : "replace");
    } else if (event.key === "Enter") {
      event.preventDefault();
      onOpen(visible[Math.min(focusIndex, visible.length - 1)]);
    } else if (event.key === "a" && event.metaKey) {
      event.preventDefault();
      onSelectionChange(new Set(ordered));
    }
  };

  return (
    <div className="file-list">
      <div className="list-head" role="row">
        {COLUMNS.map((column) => (
          <button
            key={column.key}
            type="button"
            role="columnheader"
            aria-sort={sort.key === column.key ? (sort.ascending ? "ascending" : "descending") : "none"}
            onClick={() => onSort({ key: column.key, ascending: sort.key === column.key ? !sort.ascending : true })}
          >
            {column.label}
            {sort.key === column.key && <span aria-hidden="true">{sort.ascending ? " ▲" : " ▼"}</span>}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        className="list-scroll"
        role="grid"
        aria-label="Files"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={keyDown}
        onScroll={() => setScrolled(true)}
      >
        <div className="list-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = visible[item.index];
            const isSelected = selected.has(row.key);
            const kind = fileKind(row.name, row.isFolder);
            return (
              <div
                key={row.key}
                role="row"
                aria-selected={isSelected}
                className={[
                  "file-row",
                  isSelected ? "selected" : "",
                  item.index === focusIndex ? "focused" : "",
                  introducing && item.index < INTRO_ROWS ? "intro" : "",
                ].join(" ")}
                style={{ height: item.size, transform: `translateY(${item.start}px)`, "--i": item.index } as CSSProperties}
                onClick={(event) => click(row, item.index, event)}
                onDoubleClick={() => onOpen(row)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const keys = isSelected ? selected : new Set([row.key]);
                  if (!isSelected) onSelectionChange(keys);
                  onContextMenu(row, keys);
                }}
              >
                <span role="gridcell" className="cell-name">
                  <FileIcon kind={kind} />
                  <span className="name-text">{row.name}</span>
                </span>
                <span role="gridcell" className="cell-meta">
                  {row.isFolder ? "—" : formatBytes(row.size ?? 0)}
                </span>
                <span role="gridcell" className="cell-meta">
                  {formatModified(row.lastModified)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
