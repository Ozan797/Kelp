import type { ReactElement } from "react";
import { updateScene } from "../data";
import { FolderIcon, useScenePhase } from "./scene";

const STEP_MS = [0, 1400, 3000, 7000];
const CARD_OPEN = 2;

export function UpdateReadyScene(): ReactElement {
  const [phase, ref] = useScenePhase(STEP_MS, CARD_OPEN);
  const { endpoint, folders, version, summary } = updateScene;

  return (
    <div ref={ref} className="window scene" role="img" aria-label="Animation: “Update ready” appears at the end of the status bar, and clicking it opens a card with What's new and Restart to update.">
      <div className="titlebar">
        <span className="lights" aria-hidden="true">
          <i /> <i /> <i />
        </span>
        <span className="title">{endpoint}</span>
      </div>
      <div className="pane" aria-hidden="true">
        <div className="list-head">
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
        </div>
        <ul className="list scene-list">
          {folders.map((name) => (
            <li key={name}>
              <div className="row">
                <span className="cell name">
                  <FolderIcon />
                  {name}
                </span>
                <span className="cell">—</span>
                <span className="cell">Today</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="statusbar">
          <span>{folders.length} items</span>
          <span className="scene-update">
            {phase >= 1 && (
              <span className={phase === 1 ? "scene-update-indicator pulse" : "scene-update-indicator scene-pressed"}>
                <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 2v7M4 6.5L7 9.5l3-3M2.5 12h9" />
                </svg>
                Update ready
              </span>
            )}
            {phase === CARD_OPEN && (
              <span className="scene-update-card">
                <strong>Kelp {version} is ready</strong>
                <span className="scene-update-text">{summary}</span>
                <span className="scene-update-actions">
                  <span className="button button-secondary">What's new</span>
                  <span className="button button-primary">Restart to update</span>
                </span>
                <svg className="scene-update-close" viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
