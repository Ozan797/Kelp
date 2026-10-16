import { useState } from "react";
import type { UpdaterState } from "../hooks/useUpdater";

type UpdateBannerProps = {
  state: UpdaterState;
  onRestart: () => void;
  onLater: () => void;
  onClose: () => void;
};

export function UpdateBanner({ state, onRestart, onLater, onClose }: UpdateBannerProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  if (state.kind === "idle") return null;
  if (state.kind === "message") {
    return (
      <div className="update-banner" role="status">
        <span className="update-text">{state.text}</span>
        <button type="button" className="button button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  const { version, notes } = state.update;
  return (
    <div className="update-banner" role="status">
      <span className="update-text">Kelp {version} is ready. Restart to update.</span>
      {notes && (
        <button type="button" className="button button-ghost" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>
          Release notes
        </button>
      )}
      <button type="button" className="button button-secondary" onClick={onLater}>
        Later
      </button>
      <button type="button" className="button button-primary" onClick={onRestart}>
        Restart
      </button>
      {notesOpen && <p className="update-notes">{notes}</p>}
    </div>
  );
}
