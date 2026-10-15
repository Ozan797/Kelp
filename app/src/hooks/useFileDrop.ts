import { useEffect, useRef, useState } from "react";
import { dropTarget, dropZone, type DropZone, type Place } from "../lib/drop";
import { api, type DropSummary } from "../lib/tauri";

export type Drag = { paths: string[]; summary: DropSummary | null; target: Place | null; zone: DropZone | null };

function pointAt(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

function samePlace(current: Drag, next: Pick<Drag, "target" | "zone">): boolean {
  return (
    current.zone === next.zone &&
    current.target?.bucket === next.target?.bucket &&
    current.target?.prefix === next.target?.prefix
  );
}

export function useFileDrop(open: Place | null, onDrop: (paths: string[], target: Place) => void): Drag | null {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ open, onDrop });
  latest.current = { open, onDrop };

  useEffect(() => {
    let live = true;
    const place = (x: number, y: number) => {
      const element = pointAt(x, y);
      return { target: dropTarget(element, latest.current.open), zone: dropZone(element) };
    };
    const stop = api.onFileDrop((event) => {
      if (!live) return;
      if (event.type === "leave") {
        setDrag(null);
        return;
      }
      if (event.type === "over") {
        const next = place(event.x, event.y);
        setDrag((current) => (current && !samePlace(current, next) ? { ...current, ...next } : current));
        return;
      }
      if (event.type === "drop") {
        const { target } = place(event.x, event.y);
        setDrag(null);
        if (target) latest.current.onDrop(event.paths, target);
        return;
      }
      const paths = event.paths;
      setDrag({ paths, summary: null, ...place(event.x, event.y) });
      api
        .inspectDrop(paths)
        .then((summary) => {
          if (live) setDrag((current) => (current?.paths === paths ? { ...current, summary } : current));
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
      stop.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  return drag;
}
