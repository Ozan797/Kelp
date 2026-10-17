import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const REMEMBERED_FOLDERS = 20;

type Listing = { key: string; rows: Row[]; token: string | null; pages: number };
type Remembered = Listing & { scrollTop: number };

const remembered = new Map<string, Remembered>();

function remember(listing: Listing) {
  const scrollTop = remembered.get(listing.key)?.scrollTop ?? 0;
  remembered.delete(listing.key);
  remembered.set(listing.key, { ...listing, scrollTop });
  if (remembered.size > REMEMBERED_FOLDERS) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
}

export function forgetRememberedFolders() {
  remembered.clear();
}

const empty = (key: string): Listing => ({ key, rows: [], token: null, pages: 0 });

export function useListing(connectionId: string | null, bucket: string | null, prefix: string) {
  const key = connectionId && bucket ? `${connectionId}/${bucket}/${prefix}` : "";
  const [listing, setListing] = useState<Listing>(empty(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const request = useRef(0);
  const fetching = useRef(false);

  const current = listing.key === key ? listing : (key && remembered.get(key)) || empty(key);
  const latest = useRef(current);
  latest.current = current;

  const restore = useMemo(() => {
    const saved = key ? remembered.get(key) : undefined;
    return saved ? { scrollTop: saved.scrollTop } : null;
  }, [key]);

  const show = useCallback((next: Listing) => {
    setListing(next);
    remember(next);
  }, []);

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
        const base = !replace && latest.current.key === key ? latest.current : empty(key);
        show({ key, rows: [...base.rows, ...pageToRows(page, prefix)], token: page.nextToken, pages: base.pages + 1 });
      } catch (caught) {
        if (ticket === request.current) setError(toAppError(caught));
      } finally {
        if (ticket === request.current) {
          fetching.current = false;
          setLoading(false);
        }
      }
    },
    [connectionId, bucket, prefix, key, show],
  );

  const refreshQuietly = useCallback(
    async (pages: number) => {
      if (!connectionId || !bucket) return;
      const ticket = ++request.current;
      fetching.current = true;
      setLoading(false);
      setError(null);
      try {
        const rows: Row[] = [];
        let token: string | null = null;
        let loaded = 0;
        do {
          const page: ListPage = await api.listObjects(connectionId, bucket, prefix, token);
          if (ticket !== request.current) return;
          rows.push(...pageToRows(page, prefix));
          token = page.nextToken;
          loaded += 1;
        } while (token && loaded < pages);
        show({ key, rows, token, pages: loaded });
      } catch (caught) {
        if (ticket === request.current) setError(toAppError(caught));
      } finally {
        if (ticket === request.current) fetching.current = false;
      }
    },
    [connectionId, bucket, prefix, key, show],
  );

  useEffect(() => {
    const saved = key ? remembered.get(key) : undefined;
    if (saved) refreshQuietly(saved.pages);
    else fetchPage(null, true);
  }, [key, fetchPage, refreshQuietly]);

  const loadMore = useCallback(() => {
    if (latest.current.token && !fetching.current) fetchPage(latest.current.token, false);
  }, [fetchPage]);

  const reload = useCallback(() => fetchPage(null, true), [fetchPage]);

  const rememberScroll = useCallback(
    (scrollTop: number) => {
      const saved = key ? remembered.get(key) : undefined;
      if (saved) saved.scrollTop = scrollTop;
    },
    [key],
  );

  return {
    rows: current.rows,
    loading,
    error,
    hasMore: current.token !== null,
    loadMore,
    reload,
    restore,
    rememberScroll,
  };
}
