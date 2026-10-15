export function crumbsFor(bucket: string, prefix: string): { label: string; prefix: string }[] {
  const folders = prefix.split("/").filter(Boolean);
  return [
    { label: bucket, prefix: "" },
    ...folders.map((label, index) => ({ label, prefix: `${folders.slice(0, index + 1).join("/")}/` })),
  ];
}

type ToolbarProps = {
  bucket: string;
  prefix: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (prefix: string) => void;
  filter: string;
  onFilter: (text: string) => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onUpload: () => void;
  dropKey?: string | null;
};

export function Toolbar(props: ToolbarProps) {
  const crumbs = crumbsFor(props.bucket, props.prefix);
  return (
    <header className="toolbar" data-tauri-drag-region>
      <button type="button" className="nav" aria-label="Back" disabled={!props.canBack} onClick={props.onBack}>
        ‹
      </button>
      <button type="button" className="nav" aria-label="Forward" disabled={!props.canForward} onClick={props.onForward}>
        ›
      </button>
      <nav className="crumbs" aria-label="Folder path">
        <ol>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={crumb.prefix}>
                <button
                  type="button"
                  aria-current={last ? "page" : undefined}
                  data-drop="folder"
                  data-key={crumb.prefix}
                  className={crumb.prefix === props.dropKey ? "drop-target" : undefined}
                  onClick={() => props.onNavigate(crumb.prefix)}
                >
                  {crumb.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <span className="spacer" data-tauri-drag-region />
      <input
        type="search"
        className="filter"
        placeholder="Filter this folder"
        aria-label="Filter this folder"
        value={props.filter}
        onChange={(event) => props.onFilter(event.target.value)}
      />
      <button type="button" className="toolbar-icon" aria-label="Refresh" title="Refresh (⌘R)" onClick={props.onRefresh}>
        ↻
      </button>
      <button type="button" className="button button-secondary" onClick={props.onNewFolder}>
        New folder
      </button>
      <button type="button" className="button button-primary" onClick={props.onUpload}>
        Upload
      </button>
    </header>
  );
}
