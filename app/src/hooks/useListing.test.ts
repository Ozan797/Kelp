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
});
