import { useCallback, useEffect, useState } from "react";
import { api, type UsageView } from "../lib/tauri";

export function useUsage(id: string | null, bucket: string | null, prefix: string) {
  const [usage, setUsage] = useState<UsageView | null>(null);

  useEffect(() => {
    setUsage(null);
    if (!id || bucket === null) return;
    let live = true;
    api
      .getUsage(id, bucket, prefix)
      .then((view) => {
        if (live) setUsage(view);
      })
      .catch(() => undefined);
    const stop = api.onUsageProgress((view) => {
      if (live && view.connectionId === id && view.bucket === bucket && view.prefix === prefix) setUsage(view);
    });
    return () => {
      live = false;
      stop.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [id, bucket, prefix]);

  const start = useCallback(async () => {
    if (!id || bucket === null) return;
    const view = await api.startUsageCount(id, bucket, prefix);
    if (view) setUsage(view);
  }, [id, bucket, prefix]);

  const cancel = useCallback(async () => {
    if (!id || bucket === null) return;
    const view = await api.cancelUsageCount(id, bucket, prefix);
    if (view) setUsage(view);
  }, [id, bucket, prefix]);

  return { usage, start, cancel };
}
