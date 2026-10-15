import { useCallback, useEffect, useRef, useState } from "react";
import { rowDropTarget, type Place, type RowTarget } from "../lib/drop";

const THRESHOLD = 4;

export type RowDrag = { keys: string[]; x: number; y: number; target: RowTarget | null };

type Options = {
  open: Place | null;
  connectionId: string;
  onDrop: (keys: string[], target: RowTarget, copy: boolean) => void;
};

export function useRowDrag({ open, connectionId, onDrop }: Options) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const pressed = useRef<{ keys: string[]; x: number; y: number; moving: boolean } | null>(null);
  const latest = useRef({ open, connectionId, onDrop });
  latest.current = { open, connectionId, onDrop };

  const begin = useCallback((keys: string[], x: number, y: number) => {
    pressed.current = { keys, x, y, moving: false };
  }, []);

  useEffect(() => {
    const targetAt = (x: number, y: number, keys: string[]) => {
      const { open: place, connectionId: id } = latest.current;
      return place ? rowDropTarget(document.elementFromPoint(x, y), place, keys, id) : null;
    };
    const onMove = (event: PointerEvent) => {
      const press = pressed.current;
      if (!press) return;
      if (!press.moving && Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) return;
      press.moving = true;
      setDrag({ keys: press.keys, x: event.clientX, y: event.clientY, target: targetAt(event.clientX, event.clientY, press.keys) });
    };
    const onUp = (event: PointerEvent) => {
      const press = pressed.current;
      pressed.current = null;
      if (!press?.moving) return;
      setDrag(null);
      const swallow = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const target = targetAt(event.clientX, event.clientY, press.keys);
      if (target) latest.current.onDrop(press.keys, target, event.altKey);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !pressed.current?.moving) return;
      pressed.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return { drag, begin };
}
