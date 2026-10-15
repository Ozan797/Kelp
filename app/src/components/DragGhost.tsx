import type { RowDrag } from "../hooks/useRowDrag";

export function DragGhost({ drag }: { drag: RowDrag }) {
  return (
    <div className="drag-ghost" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>
      ↕ {drag.keys.length === 1 ? "1 item" : `${drag.keys.length} items`}
    </div>
  );
}
