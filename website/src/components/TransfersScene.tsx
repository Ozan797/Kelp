import type { ReactElement } from "react";
import { transfersScene } from "../data";
import { FileIcon, useScenePhase } from "./scene";

const STEP_MS = [0, 1400, 2400, 7000];
const PANEL_OPEN = 2;

export function TransfersScene(): ReactElement {
  const [phase, ref] = useScenePhase(STEP_MS, PANEL_OPEN);
  const { endpoint, bucket, files, transfers } = transfersScene;
  const buttonClass = ["demo-icon demo-transfers", phase === 1 ? "pulse" : "", phase >= 1 ? "scene-pressed" : ""].join(" ").trim();

  return (
    <div ref={ref} className="window scene" role="img" aria-label="Animation: the transfers button in the toolbar fills with progress, and clicking it opens a panel listing each upload and download.">
      <div className="titlebar">
        <span className="lights" aria-hidden="true">
          <i /> <i /> <i />
        </span>
        <span className="title">{endpoint}</span>
      </div>
      <div className="pane" aria-hidden="true">
        <div className="toolbar">
          <span className="scene-crumb">{bucket}</span>
          <span className="demo-tools">
            <span className="demo-icon">↻</span>
            <span className="scene-transfers">
              <span className={buttonClass}>
                <svg viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="12.5" pathLength="100" />
                </svg>
                ↓↑
              </span>
              {phase === PANEL_OPEN && (
                <span className="scene-transfers-panel">
                  <span className="scene-transfers-head">
                    <strong>Transfers</strong>
                    <span>Pause all</span>
                  </span>
                  {transfers.map((t) => (
                    <span key={t.name} className="scene-transfer">
                      <span className="scene-transfer-icon">{t.glyph}</span>
                      <span className="scene-transfer-body">
                        <strong>{t.name}</strong>
                        {t.progress !== null && (
                          <span className="bar">
                            <span className="scene-bar-fill" style={{ transform: `scaleX(${t.progress})` }} />
                          </span>
                        )}
                        <small>{t.status}</small>
                      </span>
                    </span>
                  ))}
                  <span className="scene-transfers-foot">
                    <span>3 transfers</span>
                    <span>Clear finished</span>
                  </span>
                </span>
              )}
            </span>
            <span className="demo-upload">Upload</span>
          </span>
        </div>
        <div className="list-head">
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
        </div>
        <ul className="list scene-list">
          {files.map((file) => (
            <li key={file.name}>
              <div className="row">
                <span className="cell name">
                  <FileIcon />
                  {file.name}
                </span>
                <span className="cell">{file.size}</span>
                <span className="cell">{file.modified}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="statusbar">
          <span>{files.length} items</span>
          <span className="transfer">
            <span className="transfer-name">Transferring 2 files</span>
            <span className="bar">
              <span className="scene-bar-fill" style={{ transform: "scaleX(0.38)" }} />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
