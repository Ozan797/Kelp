import { useCallback, useEffect, useRef, useState } from "react";
import { api, type UsageView } from "../lib/tauri";

export function useUsage(id: string | null, bucket: string | null, prefix: string) {
  const [usage, setUsage] = useState<UsageView | null>(null);
  const known = useRef(false);

  const learn = useCallback((view: UsageView | null) => {
    known.current = true;
    if (view) setUsage(view);
  }, []);

  useEffect(() => {
    setUsage(null);
    known.current = false;
    if (!id || bucket === null) return;
    let live = true;
    api
      .getUsage(id, bucket, prefix)
      .then((view) => {
        if (live && !known.current) setUsage(view);
      })
      .catch(() => undefined);
    const stop = api.onUsageProgress((view) => {
      if (live && view.connectionId === id && view.bucket === bucket && view.prefix === prefix) learn(view);
    });
    return () => {
      live = false;
      stop.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [id, bucket, prefix, learn]);

  const start = useCallback(async () => {
    if (!id || bucket === null) return;
    learn(await api.startUsageCount(id, bucket, prefix));
  }, [id, bucket, prefix, learn]);

  const cancel = useCallback(async () => {
    if (!id || bucket === null) return;
    learn(await api.cancelUsageCount(id, bucket, prefix));
  }, [id, bucket, prefix, learn]);

  return { usage, start, cancel };
}
