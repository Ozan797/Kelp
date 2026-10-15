import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Row } from "../hooks/useListing";
import { formatBytes, formatModified } from "../lib/format";
import { TEXT_LIMIT, previewKind, previewUrl } from "../lib/preview";

type PreviewProps = {
  connectionId: string;
  bucket: string;
  files: Row[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onDownload: (row: Row) => void;
};

type Text = { state: "loading" } | { state: "ready"; body: string } | { state: "failed"; message: string };

function TextPreview({ url, size }: { url: string; size: number }) {
  const [text, setText] = useState<Text>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setText({ state: "loading" });
    fetch(url, { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } })
      .then(async (response) => {
        const body = await response.text();
        if (!live) return;
        setText(response.ok ? { state: "ready", body } : { state: "failed", message: body || "Kelp couldn't load this preview." });
      })
      .catch(() => live && setText({ state: "failed", message: "Kelp couldn't load this preview." }));
    return () => {
      live = false;
    };
  }, [url, attempt]);

  if (text.state === "loading") return <p className="preview-note">Loading…</p>;
  if (text.state === "failed") {
    return (
      <div className="preview-empty">
        <p>{text.message}</p>
        <button type="button" className="button button-secondary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="preview-text">
      {size > TEXT_LIMIT && <p className="preview-note">Showing the first 1 MB.</p>}
      <pre>{text.body}</pre>
    </div>
  );
}

export function Preview({ connectionId, bucket, files, index, onIndex, onClose, onDownload }: PreviewProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const file = files[index];

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => before?.focus();
  }, []);

  if (!file) return null;
  const url = previewUrl(connectionId, bucket, file.key);
  const kind = previewKind(file);
  const download = `Download ${file.name}`;

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === " ") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowRight" && index < files.length - 1) {
      event.preventDefault();
      onIndex(index + 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      onIndex(index - 1);
    }
  };

  return (
    <div className="sheet-backdrop preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialog} className="preview" role="dialog" aria-modal="true" aria-label={file.name} tabIndex={-1} onKeyDown={keyDown}>
        <header className="preview-head">
          <strong>{file.name}</strong>
          <span className="preview-meta">
            {formatBytes(file.size ?? 0)} · {formatModified(file.lastModified)} · {index + 1} of {files.length}
          </span>
          <button type="button" className="preview-step" aria-label="Previous file" disabled={index === 0} onClick={() => onIndex(index - 1)}>
            ‹
          </button>
          <button type="button" className="preview-step" aria-label="Next file" disabled={index === files.length - 1} onClick={() => onIndex(index + 1)}>
            ›
          </button>
          <button type="button" className="button button-secondary" aria-label={download} onClick={() => onDownload(file)}>
            Download
          </button>
          <button type="button" className="preview-close" aria-label="Close preview" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="preview-body">
          {kind === "image" && <img src={url} alt={file.name} />}
          {kind === "video" && <video src={url} controls />}
          {kind === "text" && <TextPreview key={url} url={url} size={file.size ?? 0} />}
          {kind === "none" && (
            <div className="preview-empty">
              <p>No preview for this kind of file.</p>
              <button type="button" className="button button-primary" aria-label={download} onClick={() => onDownload(file)}>
                Download {formatBytes(file.size ?? 0)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
