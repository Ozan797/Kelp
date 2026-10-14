import { useCallback, useEffect, useRef, useState } from "react";
import { displayName } from "../lib/format";
import { api, toAppError, type AppError, type ListPage } from "../lib/tauri";

export type Row = { key: string; name: string; isFolder: boolean; size: number | null; lastModified: string | null };

export function pageToRows(page: ListPage, prefix: string): Row[] {
  const folders = page.folders.map((key) => ({
    key,
    name: displayName(key, prefix),
    isFolder: true,
    size: null,
    lastModified: null,
  }));
  const files = page.objects.map((object) => ({
    key: object.key,
    name: displayName(object.key, prefix),
    isFolder: false,
    size: object.size,
    lastModified: object.lastModified,
  }));
  return [...folders, ...files];
}

export function useListing(connectionId: string | null, bucket: string | null, prefix: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const request = useRef(0);
  const fetching = useRef(false);

  const fetchPage = useCallback(
    async (pageToken: string | null, replace: boolean) => {
      const ticket = ++request.current;
      if (!connectionId || !bucket) {
        fetching.current = false;
        setLoading(false);
        return;
      }
      fetching.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await api.listObjects(connectionId, bucket, prefix, pageToken);
        if (ticket !== request.current) return;
        setRows((current) => (replace ? pageToRows(page, prefix) : [...current, ...pageToRows(page, prefix)]));
        setToken(page.nextToken);
      } catch (caught) {
        if (ticket === request.current) setError(toAppError(caught));
      } finally {
        if (ticket === request.current) {
          fetching.current = false;
          setLoading(false);
        }
      }
    },
    [connectionId, bucket, prefix],
  );

  useEffect(() => {
    setRows([]);
    setToken(null);
    fetchPage(null, true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (token && !fetching.current) fetchPage(token, false);
  }, [token, fetchPage]);

  const reload = useCallback(() => fetchPage(null, true), [fetchPage]);

  return { rows, loading, error, hasMore: token !== null, loadMore, reload };
}
