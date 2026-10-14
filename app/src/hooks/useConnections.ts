import { useCallback, useEffect, useState } from "react";
import { api, toAppError, type AppError, type ConnectionProfile } from "../lib/tauri";

export function useConnections() {
  const [connections, setConnections] = useState<ConnectionProfile[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async () => {
    try {
      setConnections(await api.listConnections());
      setError(null);
    } catch (caught) {
      setError(toAppError(caught));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { connections, error, reload };
}
