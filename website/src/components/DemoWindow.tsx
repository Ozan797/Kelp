import { useEffect, useMemo, useRef, useState } from "react";
import { providers, type Entry } from "../data";
import { BrandLogo } from "./BrandLogo";

function FolderIcon() {
  return (
    <svg className="row-icon folder" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.6c.4 0 .8.2 1.1.5L9.3 6h7.2A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="row-icon file" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 2.5h6.2L15 6.3V16.5A1 1 0 0 1 14 17.5H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"
        fill="currentColor"
      />
    </svg>
  );
}

function resolve(root: Entry[], path: string[]): Entry[] {
  let list = root;
  for (const segment of path) {
    const next = list.find((e) => e.name === segment && e.kind === "folder");
    list = next?.children ?? [];
  }
  return list;
}

export default function DemoWindow() {
  const [providerIndex, setProviderIndex] = useState(0);
  const [path, setPath] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // Real listings take a moment, so the demo shows the app's loading state briefly on every move.
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const load = () => {
    window.clearTimeout(timer.current);
    setLoading(true);
    timer.current = window.setTimeout(() => setLoading(false), 450);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const provider = providers[providerIndex];
  const entries = useMemo(
    () => resolve(provider.root, path),
    [provider, path],
  );

  const choose = (index: number) => {
    setProviderIndex(index);
    setPath([]);
    setSelected(null);
    load();
  };

  const open = (entry: Entry) => {
    if (entry.kind === "folder") {
      setPath([...path, entry.name]);
      setSelected(null);
      load();
    } else {
      setSelected(entry.name);
    }
  };

  const goTo = (depth: number) => {
    setPath(path.slice(0, depth));
    setSelected(null);
    load();
  };

  return (
    <div className="window" role="group" aria-label="Interactive preview of the app">
      <div className="titlebar">
        <span className="lights" aria-hidden="true">
          <i /> <i /> <i />
        </span>
        <span className="title">{provider.label}</span>
      </div>

      <div className="window-body">
        <div className="sidebar" role="group" aria-label="Connections">
          <p className="side-label">Connections</p>
          {providers.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={i === providerIndex ? "side-item active" : "side-item"}
              aria-pressed={i === providerIndex}
              onClick={() => choose(i)}
            >
              <BrandLogo brand={p.id} className={`side-logo ${p.id}`} />
              {p.label}
            </button>
          ))}
        </div>

        <div className="pane">
          <div className="toolbar">
            <button
              type="button"
              className="back"
              onClick={() => goTo(path.length - 1)}
              disabled={path.length === 0}
              aria-label="Go up one folder"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M10 3 5 8l5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <ol className="crumbs">
              <li>
                <button type="button" onClick={() => goTo(0)}>
                  {provider.endpoint}
                </button>
              </li>
              {path.map((segment, i) => (
                <li key={`${segment}-${i}`}>
                  <button type="button" onClick={() => goTo(i + 1)}>
                    {segment}
                  </button>
                </li>
              ))}
            </ol>
            <span className="demo-tools" aria-hidden="true">
              <span className="demo-icon">↻</span>
              <span className="demo-icon demo-transfers">
                <svg viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="12.5" pathLength="100" />
                </svg>
                ↓↑
              </span>
              <span className="demo-upload">Upload</span>
            </span>
          </div>

          <div className="list-head" aria-hidden="true">
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
          </div>

          <ul className="list" aria-busy={loading}>
            {loading &&
              [70, 55, 62, 40].map((width) => (
                <li key={width} className="row skeleton-row" aria-hidden="true">
                  <span className="cell name">
                    <span className="skeleton skeleton-icon" />
                    <span className="skeleton skeleton-line" style={{ width: `${width}%` }} />
                  </span>
                  <span className="skeleton skeleton-line" />
                  <span className="skeleton skeleton-line" />
                </li>
              ))}
            {!loading && entries.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  className={
                    selected === entry.name ? "row selected" : "row"
                  }
                  onClick={() => open(entry)}
                >
                  <span className="cell name">
                    {entry.kind === "folder" ? <FolderIcon /> : <FileIcon />}
                    {entry.name}
                  </span>
                  <span className="cell">{entry.size ?? "—"}</span>
                  <span className="cell">{entry.modified}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="statusbar">
            {loading ? (
              <span className="loading-note">
                <span className="spinner" aria-hidden="true" />
                Loading files
              </span>
            ) : (
              <span>
                {entries.length} {entries.length === 1 ? "item" : "items"}
              </span>
            )}
            <span className="transfer">
              <span className="transfer-name">Uploading 1 file</span>
              <span className="bar">
                <span className="bar-fill" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
