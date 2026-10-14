import { useMemo, useState } from "react";
import { providers, type Entry } from "../data";

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

  const provider = providers[providerIndex];
  const entries = useMemo(
    () => resolve(provider.root, path),
    [provider, path],
  );

  const choose = (index: number) => {
    setProviderIndex(index);
    setPath([]);
    setSelected(null);
  };

  const open = (entry: Entry) => {
    if (entry.kind === "folder") {
      setPath([...path, entry.name]);
      setSelected(null);
    } else {
      setSelected(entry.name);
    }
  };

  const goTo = (depth: number) => {
    setPath(path.slice(0, depth));
    setSelected(null);
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
        <nav className="sidebar" aria-label="Connections">
          <p className="side-label">Connections</p>
          {providers.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={i === providerIndex ? "side-item active" : "side-item"}
              aria-pressed={i === providerIndex}
              onClick={() => choose(i)}
            >
              <span className={`dot ${p.id}`} aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </nav>

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
          </div>

          <div className="list-head" aria-hidden="true">
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
          </div>

          <ul className="list">
            {entries.map((entry) => (
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
            <span>
              {entries.length} {entries.length === 1 ? "item" : "items"}
            </span>
            <span className="transfer" aria-label="Upload in progress">
              <span className="transfer-name">launch-teaser.mp4</span>
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
