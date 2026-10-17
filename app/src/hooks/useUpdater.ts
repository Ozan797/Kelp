import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PendingUpdate } from "../lib/tauri";

export const CHECK_EVERY_MS = 30 * 60 * 1000;
export const UPDATES_OFF = "Updates are off in development builds.";
export const CHECK_FAILED = "Kelp couldn't check for updates. Check your internet connection and try again.";
export const INSTALL_FAILED = "Kelp couldn't install the update. Restart Kelp and try again.";
export const upToDate = (version: string) => `Kelp is up to date (${version}).`;
export const restartQuestion = (count: number) =>
  count === 1
    ? "1 transfer is running. Restart now? It'll resume after Kelp reopens."
    : `${count} transfers are running. Restart now? They'll resume after Kelp reopens.`;

export function useUpdater(enabled: boolean) {
  const [ready, setReady] = useState<PendingUpdate | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef<Promise<PendingUpdate | null> | null>(null);
  const found = useRef<PendingUpdate | null>(null);
  const dismissed = useRef<string | null>(null);
  const lastCheck = useRef(Date.now());

  const find = useCallback(() => {
    inFlight.current ??= api.checkForUpdate().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  const say = useCallback((text: string) => {
    setMessage(text);
    setCardOpen(true);
  }, []);

  const check = useCallback(
    async (manual: boolean) => {
      if (!enabled) {
        if (manual) say(UPDATES_OFF);
        return;
      }
      lastCheck.current = Date.now();
      try {
        const update = found.current ?? (await find());
        if (update) {
          found.current = update;
          if (manual) {
            dismissed.current = null;
            setMessage(null);
            setReady(update);
            setCardOpen(true);
          } else if (dismissed.current !== update.version) {
            setReady(update);
          }
          return;
        }
        if (manual) say(upToDate(await api.appVersion()));
      } catch {
        if (manual) say(CHECK_FAILED);
      }
    },
    [enabled, find, say],
  );

  useEffect(() => {
    void check(false);
    const timer = setInterval(() => void check(false), CHECK_EVERY_MS);
    const stopMenu = api.onCheckForUpdates(() => void check(true));
    const stopFocus = api.onWindowFocus(() => {
      if (Date.now() - lastCheck.current >= CHECK_EVERY_MS) void check(false);
    });
    return () => {
      clearInterval(timer);
      void stopMenu.then((unlisten) => unlisten());
      void stopFocus.then((unlisten) => unlisten());
    };
  }, [check]);

  const openCard = useCallback(() => setCardOpen(true), []);

  const closeCard = useCallback(() => {
    setCardOpen(false);
    setMessage(null);
  }, []);

  const dismiss = useCallback(() => {
    dismissed.current = found.current?.version ?? null;
    found.current = null;
    setReady(null);
    setCardOpen(false);
  }, []);

  const checkNow = useCallback(() => void check(true), [check]);

  const restart = useCallback(async (runningTransfers: number) => {
    const update = found.current;
    if (!update) return;
    if (runningTransfers > 0 && !(await api.confirm(restartQuestion(runningTransfers), "Restart"))) return;
    try {
      await update.install();
      await api.restartApp();
    } catch {
      say(INSTALL_FAILED);
    }
  }, [say]);

  return { ready, cardOpen, message, openCard, closeCard, dismiss, checkNow, restart };
}
