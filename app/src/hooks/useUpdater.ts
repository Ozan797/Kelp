import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PendingUpdate } from "../lib/tauri";

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const UPDATES_OFF = "Updates are off in development builds.";
export const CHECK_FAILED = "Kelp couldn't check for updates. Check your internet connection and try again.";
export const INSTALL_FAILED = "Kelp couldn't install the update. Restart Kelp and try again.";
export const upToDate = (version: string) => `Kelp is up to date (${version}).`;
export const restartQuestion = (count: number) =>
  count === 1
    ? "1 transfer is running. Restart now? It'll resume after Kelp reopens."
    : `${count} transfers are running. Restart now? They'll resume after Kelp reopens.`;

export type UpdaterState = { kind: "idle" } | { kind: "ready"; update: PendingUpdate } | { kind: "message"; text: string };

export function useUpdater(enabled: boolean) {
  const [state, setState] = useState<UpdaterState>({ kind: "idle" });
  const inFlight = useRef<Promise<PendingUpdate | null> | null>(null);
  const ready = useRef<PendingUpdate | null>(null);
  const hidden = useRef<string | null>(null);

  const find = useCallback(() => {
    inFlight.current ??= api.checkForUpdate().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  const check = useCallback(
    async (manual: boolean) => {
      if (!enabled) {
        if (manual) setState({ kind: "message", text: UPDATES_OFF });
        return;
      }
      try {
        const update = ready.current ?? (await find());
        if (update) {
          ready.current = update;
          if (manual || hidden.current !== update.version) setState({ kind: "ready", update });
          return;
        }
        if (manual) setState({ kind: "message", text: upToDate(await api.appVersion()) });
      } catch {
        if (manual) setState({ kind: "message", text: CHECK_FAILED });
      }
    },
    [enabled, find],
  );

  useEffect(() => {
    void check(false);
    const timer = setInterval(() => void check(false), CHECK_EVERY_MS);
    const stop = api.onCheckForUpdates(() => void check(true));
    return () => {
      clearInterval(timer);
      void stop.then((unlisten) => unlisten());
    };
  }, [check]);

  const later = useCallback(() => {
    hidden.current = ready.current?.version ?? null;
    setState({ kind: "idle" });
  }, []);

  const close = useCallback(() => setState({ kind: "idle" }), []);

  const restart = useCallback(async (runningTransfers: number) => {
    const update = ready.current;
    if (!update) return;
    if (runningTransfers > 0 && !(await api.confirm(restartQuestion(runningTransfers), "Restart"))) return;
    try {
      await update.install();
      await api.restartApp();
    } catch {
      setState({ kind: "message", text: INSTALL_FAILED });
    }
  }, []);

  return { state, checkNow: () => void check(true), later, close, restart };
}
