import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, toAppError, type AppError, type ConnectionProfile } from "../lib/tauri";
import { PROVIDER_NAMES } from "./Rail";

type CopySheetProps = {
  connection: ConnectionProfile;
  names: string[];
  onCopy: (bucket: string, prefix: string) => void;
  onCancel: () => void;
};

const items = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "item" : "items"}`;

function parentOf(prefix: string): string {
  const parts = prefix.split("/").filter(Boolean).slice(0, -1);
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

export function CopySheet({ connection, names, onCopy, onCancel }: CopySheetProps) {
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    api
      .listBuckets(connection.id)
      .then((list) => {
        setBuckets(list);
        const last = connection.lastLocation?.bucket;
        setBucket(last && list.includes(last) ? last : (list[0] ?? null));
      })
      .catch((caught) => setError(toAppError(caught)));
  }, [connection.id]);

  useEffect(() => {
    if (!bucket) return;
    let live = true;
    api
      .listObjects(connection.id, bucket, prefix, null)
      .then((page) => live && setFolders(page.folders))
      .catch((caught) => live && setError(toAppError(caught)));
    return () => {
      live = false;
    };
  }, [connection.id, bucket, prefix]);

  const what = names.length <= 2 ? names.join(" and ") : items(names.length);
  const path = bucket ? `${[bucket, ...prefix.split("/").filter(Boolean)].join(" / ")} /` : "";

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") onCancel();
  };

  return (
    <div className="sheet-backdrop" onKeyDown={keyDown}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="copy-title">
        <h2 id="copy-title">
          Copy {items(names.length)} to {PROVIDER_NAMES[connection.settings.kind]} · {connection.name}
        </h2>
        <p className="sheet-note">{what}. They stay where they are.</p>
        {error && (
          <p className="field-error" role="alert">
            {error.message}
          </p>
        )}
        {buckets && (
          <fieldset className="pick-list" aria-label="Bucket">
            {buckets.map((name) => (
              <label key={name} className={name === bucket ? "pick selected" : "pick"}>
                <input
                  type="radio"
                  name="copy-bucket"
                  checked={name === bucket}
                  onChange={() => {
                    setBucket(name);
                    setPrefix("");
                  }}
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        {bucket && (
          <div className="pick-folders">
            <p className="sheet-note">
              Into <strong>{path}</strong>
            </p>
            <ul className="pick-list" aria-label="Folders">
              {prefix && (
                <li>
                  <button type="button" className="link-button" onClick={() => setPrefix(parentOf(prefix))}>
                    Up one folder
                  </button>
                </li>
              )}
              {folders.map((folder) => (
                <li key={folder}>
                  <button type="button" className="pick" onClick={() => setPrefix(folder)}>
                    {folder.slice(prefix.length).replace(/\/$/, "")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" ref={cancel} className="button button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button-primary" disabled={!bucket} onClick={() => bucket && onCopy(bucket, prefix)}>
            Copy {items(names.length)}
          </button>
        </div>
      </div>
    </div>
  );
}
