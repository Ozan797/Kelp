import { useCallback, useEffect, useReducer } from "react";
import {
  api,
  type AppError,
  type TransferInfo,
  type TransferProgress,
  type TransferStateEvent,
  type TransferStatus,
} from "../lib/tauri";

export type Transfer = TransferInfo & { status: TransferStatus; done: number; error: AppError | null; path: string | null };

export type TransferAction =
  | { type: "state"; event: TransferStateEvent }
  | { type: "progress"; event: TransferProgress }
  | { type: "clearFinished" };

export function transfersReducer(state: Transfer[], action: TransferAction): Transfer[] {
  switch (action.type) {
    case "state": {
      const { event } = action;
      if (event.info) {
        if (state.some((t) => t.id === event.id)) return state;
        return [...state, { ...event.info, status: event.state, done: 0, error: null, path: null }];
      }
      return state.map((t) =>
        t.id === event.id ? { ...t, status: event.state, error: event.error, path: event.path, done: event.state === "finished" ? t.total : t.done } : t,
      );
    }
    case "progress":
      return state.map((t) => (t.id === action.event.id ? { ...t, done: action.event.done } : t));
    case "clearFinished":
      return state.filter((t) => t.status === "running" || t.status === "failed");
  }
}

export function useTransfers() {
  const [transfers, dispatch] = useReducer(transfersReducer, []);

  useEffect(() => {
    const stops = [
      api.onTransferState((event) => dispatch({ type: "state", event })),
      api.onTransferProgress((event) => dispatch({ type: "progress", event })),
    ];
    return () => {
      stops.forEach((stop) => stop.then((unlisten) => unlisten()));
    };
  }, []);

  const clearFinished = useCallback(() => dispatch({ type: "clearFinished" }), []);
  return { transfers, clearFinished };
}
