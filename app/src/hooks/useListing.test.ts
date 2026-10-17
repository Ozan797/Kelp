import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ListPage } from "../lib/tauri";
import { useListing } from "./useListing";

const page: ListPage = {
  folders: [],
  objects: [{ key: "a.mp4", size: 1, lastModified: null }],
  nextToken: "next",
};

afterEach(() => vi.restoreAllMocks());

const files = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ key: `${prefix}f${i}`, size: 1, lastModified: null }));
const pageOf = (objects: ListPage["objects"], nextToken: string | null): ListPage => ({ folders: [], objects, nextToken });
const never = () => new Promise<ListPage>(() => undefined);

describe("useListing", () => {
  it("drops a late response after switching to no bucket", async () => {
    let resolve: (value: ListPage) => void = () => {};
    vi.spyOn(api, "listObjects").mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, rerender } = renderHook(
      ({ bucket }: { bucket: string | null }) => useListing("c1", bucket, ""),
      { initialProps: { bucket: "media" as string | null } },
    );
    await waitFor(() => expect(result.current.loading).toBe(true));
    rerender({ bucket: null });
    await act(async () => resolve(page));
    expect(result.current.rows).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("fetches a page token once when loadMore is called twice", async () => {
    const spy = vi.spyOn(api, "listObjects").mockResolvedValue(page);
    const { result } = renderHook(() => useListing("c1", "media", ""));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(spy.mock.calls.filter((call) => call[3] === "next")).toHaveLength(1);
  });

  it("shows a remembered folder and its scroll position at once on the way back", async () => {
    const list = vi.spyOn(api, "listObjects").mockImplementation(async (_id, _bucket, prefix) => pageOf(files(prefix, 3), null));
    const { result, rerender } = renderHook(({ prefix }: { prefix: string }) => useListing("remember-1", "media", prefix), {
      initialProps: { prefix: "" },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.restore).toBeNull();
    act(() => result.current.rememberScroll(420));
    rerender({ prefix: "sub/" });
    await waitFor(() => expect(result.current.rows[0]?.key).toBe("sub/f0"));
    list.mockImplementation(never);
    rerender({ prefix: "" });
    expect(result.current.rows.map((row) => row.key)).toEqual(["f0", "f1", "f2"]);
    expect(result.current.restore).toEqual({ scrollTop: 420 });
    expect(result.current.loading).toBe(false);
  });

  it("quietly refreshes a remembered folder with as many pages as were loaded, keeping the position", async () => {
    let fresh = false;
    const list = vi.spyOn(api, "listObjects").mockImplementation(async (_id, _bucket, prefix, token) => {
      if (prefix === "sub/") return pageOf(files("sub/", 1), null);
      const tag = fresh ? "new" : "old";
      if (token === null) return pageOf(files(`${tag}-a`, 2), "t2");
      if (token === "t2") return pageOf(files(`${tag}-b`, 2), "t3");
      return pageOf(files(`${tag}-c`, 2), null);
    });
    const { result, rerender } = renderHook(({ prefix }: { prefix: string }) => useListing("remember-2", "media", prefix), {
      initialProps: { prefix: "" },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(6));
    act(() => result.current.rememberScroll(5000));
    rerender({ prefix: "sub/" });
    await waitFor(() => expect(result.current.rows[0]?.key).toBe("sub/f0"));
    fresh = true;
    list.mockClear();
    rerender({ prefix: "" });
    expect(result.current.rows[0].key).toBe("old-af0");
    await waitFor(() => expect(result.current.rows[0].key).toBe("new-af0"));
    expect(result.current.rows).toHaveLength(6);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.restore).toEqual({ scrollTop: 5000 });
    expect(list.mock.calls.filter((call) => call[2] === "").map((call) => call[3])).toEqual([null, "t2", "t3"]);
  });

  it("forgets the oldest folder once more than 20 are remembered", async () => {
    const list = vi.spyOn(api, "listObjects").mockImplementation(async (_id, _bucket, prefix) => pageOf(files(prefix, 1), null));
    const { result, rerender } = renderHook(({ prefix }: { prefix: string }) => useListing("remember-3", "media", prefix), {
      initialProps: { prefix: "p0/" },
    });
    for (let i = 0; i <= 20; i++) {
      rerender({ prefix: `p${i}/` });
      await waitFor(() => expect(result.current.rows[0]?.key).toBe(`p${i}/f0`));
    }
    list.mockImplementation(never);
    rerender({ prefix: "p0/" });
    expect(result.current.rows).toEqual([]);
    expect(result.current.restore).toBeNull();
    rerender({ prefix: "p1/" });
    expect(result.current.rows[0]?.key).toBe("p1/f0");
  });
});

