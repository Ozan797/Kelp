import type { ReactElement } from "react";
import { memoryScene } from "../data";
import { FileIcon, FolderIcon, useScenePhase } from "./scene";

const ROW_HEIGHT = 30;
const SCROLLED_ROWS = 4;
const VISIBLE_ROWS = 6;
const STEP_MS = [0, 1200, 2000, 3400, 4000, 5400, 6000];

export function FolderMemoryScene(): ReactElement {
  const [phase, ref] = useScenePhase(STEP_MS, 0);
  const { endpoint, folders, opened, inside } = memoryScene;
  const inFolder = phase === 2 || phase === 3;
  const offset = inFolder ? 0 : SCROLLED_ROWS * ROW_HEIGHT;
  const rows = inFolder ? inside : folders.map((name) => ({ name, size: "—", modified: "Today" }));
  const count = rows.length;

  return (
    <div ref={ref} className="window scene" role="img" aria-label="Animation: a folder list scrolled down, a folder opens, and going back returns to the same scroll position.">
      <div className="titlebar">
        <span className="lights" aria-hidden="true">
          <i /> <i /> <i />
        </span>
        <span className="title">Amazon S3</span>
      </div>
      <div className="pane">
        <div className="toolbar">
          <span className={phase === 3 ? "back scene-pressed" : "back"} aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path
                d="M10 3 5 8l5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <ol className="crumbs">
            <li>
              <span>{endpoint}</span>
            </li>
            {inFolder && (
              <li>
                <span>{opened}</span>
              </li>
            )}
          </ol>
        </div>
        <div className="list-head" aria-hidden="true">
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
        </div>
        <div className="scene-viewport" style={{ height: ROW_HEIGHT * VISIBLE_ROWS }} aria-hidden="true">
          <ul className="list scene-list" style={{ transform: `translateY(-${offset}px)` }}>
            {rows.map((row, i) => {
              const isFolder = inFolder ? row.size === "—" : true;
              const highlighted = !inFolder && row.name === opened && phase === 1;
              const returned = phase >= 4 && !inFolder && i === SCROLLED_ROWS;
              const className = [
                "row",
                highlighted ? "selected" : "",
                returned ? "scene-returned" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={row.name}>
                  <div className={className}>
                    <span className="cell name">
                      {isFolder ? <FolderIcon /> : <FileIcon />}
                      {row.name}
                    </span>
                    <span className="cell">{row.size}</span>
                    <span className="cell">{row.modified}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="statusbar">
          <span>
            {count} {count === 1 ? "item" : "items"}
          </span>
        </div>
      </div>
    </div>
  );
}
