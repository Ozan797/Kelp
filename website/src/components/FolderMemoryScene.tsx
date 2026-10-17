import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { memoryScene } from "../data";

const ROW_HEIGHT = 30;
const SCROLLED_ROWS = 4;
const VISIBLE_ROWS = 6;
const STEP_MS = [0, 1200, 2000, 3400, 4000, 5400, 6000];

type Phase = 0 | 1 | 2 | 3 | 4 | 5;

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

function usePhase(): [Phase, RefObject<HTMLDivElement>] {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const play = () => {
      STEP_MS.forEach((ms, i) => {
        timers.push(
          window.setTimeout(() => {
            if (i === STEP_MS.length - 1) {
              setPhase(0);
              play();
            } else {
              setPhase(i as Phase);
            }
          }, ms),
        );
      });
    };
    const stop = () => {
      timers.forEach(window.clearTimeout);
      timers.length = 0;
    };
    const observer = new IntersectionObserver(([entry]) => {
      stop();
      if (entry.isIntersecting) play();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, []);

  return [phase, ref];
}

export function FolderMemoryScene(): ReactElement {
  const [phase, ref] = usePhase();
  const { endpoint, folders, opened, inside } = memoryScene;
  const inFolder = phase === 2 || phase === 3;
  const offset = inFolder ? 0 : SCROLLED_ROWS * ROW_HEIGHT;
  const rows = inFolder ? inside : folders.map((name) => ({ name, size: "—", modified: "Today" }));
  const count = rows.length;

  return (
    <div ref={ref} className="window scene" role="img" aria-label="Kelp returns to the same scroll position when you go back to a folder">
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
