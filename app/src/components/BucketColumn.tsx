import type { AppError, ConnectionProfile } from "../lib/tauri";
import { PROVIDER_NAMES } from "./Rail";

type BucketColumnProps = {
  connection: ConnectionProfile;
  buckets: string[] | null;
  error: AppError | null;
  selected: string | null;
  onSelect: (bucket: string) => void;
};

export function BucketColumn({ connection, buckets, error, selected, onSelect }: BucketColumnProps) {
  return (
    <aside className="buckets" aria-label="Buckets" data-tauri-drag-region>
      <header className="buckets-head">
        <h2>
          {PROVIDER_NAMES[connection.settings.kind]} · {connection.name}
        </h2>
        <span>{connection.settings.region}</span>
      </header>
      {buckets === null && !error && (
        <div className="buckets-loading" aria-label="Loading buckets">
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      )}
      {error && <p className="buckets-note">{error.message}</p>}
      {buckets?.length === 0 && <p className="buckets-note">This connection has no buckets yet.</p>}
      <ul role="list">
        {buckets?.map((bucket) => (
          <li key={bucket}>
            <button
              type="button"
              className={bucket === selected ? "bucket selected" : "bucket"}
              aria-current={bucket === selected ? "true" : undefined}
              onClick={() => onSelect(bucket)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 6h12l-1.3 9.2a1.5 1.5 0 0 1-1.5 1.3H6.8a1.5 1.5 0 0 1-1.5-1.3z" fill="currentColor" />
              </svg>
              {bucket}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
