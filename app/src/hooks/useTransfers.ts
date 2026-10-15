import { useCallback, useEffect, useReducer } from "react";
import { api, type TransferProgress, type TransferView } from "../lib/tauri";

type Sample = { at: number; done: number };

export type Transfer = TransferView & { speed: number | null; sample: Sample | null };

export type TransferAction =
  | { type: "state"; view: TransferView }
  | { type: "progress"; event: TransferProgress; at: number }
  | { type: "loaded"; views: TransferView[] }
  | { type: "clearFinished" };

const SMOOTHING = 0.3;

function fresh(view: TransferView): Transfer {
  return { ...view, speed: null, sample: null };
}

function withView(current: Transfer, view: TransferView): Transfer {
  const moving = view.status === "running";
  return {
    ...view,
    done: view.status === "finished" ? view.total : view.done,
    speed: moving ? current.speed : null,
    sample: moving ? current.sample : null,
  };
}

function withProgress(current: Transfer, event: TransferProgress, at: number): Transfer {
  const previous = current.sample;
  const elapsed = previous ? (at - previous.at) / 1000 : 0;
  const latest = previous && elapsed > 0 ? Math.max(event.done - previous.done, 0) / elapsed : null;
  const speed = latest === null ? current.speed : current.speed === null ? latest : current.speed * (1 - SMOOTHING) + latest * SMOOTHING;
  return { ...current, done: event.done, total: event.total, filesDone: event.filesDone, speed, sample: { at, done: event.done } };
}

export function transfersReducer(state: Transfer[], action: TransferAction): Transfer[] {
  switch (action.type) {
    case "state": {
      const { view } = action;
      if (!state.some((t) => t.id === view.id)) return [...state, withView(fresh(view), view)];
      return state.map((t) => (t.id === view.id ? withView(t, view) : t));
    }
    case "progress":
      return state.map((t) => (t.id === action.event.id ? withProgress(t, action.event, action.at) : t));
    case "loaded": {
      const known = new Set(state.map((t) => t.id));
      return [...state, ...action.views.filter((view) => !known.has(view.id)).map(fresh)];
    }
    case "clearFinished":
      return state.filter((t) => t.status !== "finished" && t.status !== "cancelled");
  }
}

export function useTransfers() {
  const [transfers, dispatch] = useReducer(transfersReducer, []);

  useEffect(() => {
    let live = true;
    const stops = [
      api.onTransferState((view) => dispatch({ type: "state", view })),
      api.onTransferProgress((event) => dispatch({ type: "progress", event, at: Date.now() })),
    ];
    api
      .listTransfers()
      .then((views) => {
        if (live) dispatch({ type: "loaded", views });
      })
      .catch(() => undefined);
    return () => {
      live = false;
      stops.forEach((stop) => stop.then((unlisten) => unlisten()));
    };
  }, []);

  const clearFinished = useCallback(() => dispatch({ type: "clearFinished" }), []);
  return { transfers, clearFinished };
}
