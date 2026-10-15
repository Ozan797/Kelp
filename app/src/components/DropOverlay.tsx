import { pillText, summaryText, type Place } from "../lib/drop";
import type { Drag } from "../hooks/useFileDrop";

type DropOverlayProps = { drag: Drag; open: Place | null };

export function DropOverlay({ drag, open }: DropOverlayProps) {
  const covering = open !== null && drag.target !== null && drag.zone !== "bucket";
  return (
    <>
      {covering && <div className="drop-panel" aria-hidden="true" />}
      <div className="drop-pill" aria-hidden="true">
        {pillText(summaryText(drag.summary, drag.paths.length), drag.target)}
      </div>
    </>
  );
}
