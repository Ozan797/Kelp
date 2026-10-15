import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type UsageView } from "../lib/tauri";
import { useUsage } from "./useUsage";

const view = (prefix: string, bytes: number): UsageView => ({
  connectionId: "c1",
  bucket: "media",
  prefix,
  bytes,
  objects: 1,
  countedAtMs: 0,
  complete: true,
  resumeToken: null,
  counting: false,
  error: null,
});

afterEach(() => vi.restoreAllMocks());

describe("useUsage", () => {
  it("loads the size of each place it is pointed at", async () => {
    const get = vi.spyOn(api, "getUsage").mockImplementation(async (_id, _bucket, prefix) => view(prefix, prefix.length));
    vi.spyOn(api, "onUsageProgress").mockResolvedValue(() => undefined);
    const { result, rerender } = renderHook(({ prefix }: { prefix: string }) => useUsage("c1", "media", prefix), {
      initialProps: { prefix: "a/" },
    });
    await waitFor(() => expect(result.current.usage?.bytes).toBe(2));
    rerender({ prefix: "abc/" });
    await waitFor(() => expect(result.current.usage?.bytes).toBe(4));
    expect(get).toHaveBeenCalledWith("c1", "media", "abc/");
  });

  it("applies progress only for its own place", async () => {
    vi.spyOn(api, "getUsage").mockResolvedValue(null);
    let emit: (next: UsageView) => void = () => undefined;
    vi.spyOn(api, "onUsageProgress").mockImplementation(async (handler) => {
      emit = handler;
      return () => undefined;
    });
    const { result } = renderHook(() => useUsage("c1", "media", "2026/"));
    await waitFor(() => expect(api.onUsageProgress).toHaveBeenCalled());
    act(() => emit(view("other/", 99)));
    expect(result.current.usage).toBeNull();
    act(() => emit(view("2026/", 42)));
    expect(result.current.usage?.bytes).toBe(42);
  });

  it("keeps a started count when an older load answers late", async () => {
    let answer: (value: UsageView | null) => void = () => undefined;
    vi.spyOn(api, "getUsage").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    vi.spyOn(api, "onUsageProgress").mockResolvedValue(() => undefined);
    vi.spyOn(api, "startUsageCount").mockResolvedValue({ ...view("2026/", 0), counting: true, complete: false });
    const { result } = renderHook(() => useUsage("c1", "media", "2026/"));
    await act(async () => result.current.start());
    await act(async () => answer(null));
    expect(result.current.usage?.counting).toBe(true);
  });

  it("starts and cancels counts for its place", async () => {
    vi.spyOn(api, "getUsage").mockResolvedValue(null);
    vi.spyOn(api, "onUsageProgress").mockResolvedValue(() => undefined);
    const start = vi.spyOn(api, "startUsageCount").mockResolvedValue({ ...view("2026/", 0), counting: true, complete: false });
    const cancel = vi.spyOn(api, "cancelUsageCount").mockResolvedValue({ ...view("2026/", 5), complete: false });
    const { result } = renderHook(() => useUsage("c1", "media", "2026/"));
    await act(async () => result.current.start());
    expect(start).toHaveBeenCalledWith("c1", "media", "2026/");
    expect(result.current.usage?.counting).toBe(true);
    await act(async () => result.current.cancel());
    expect(cancel).toHaveBeenCalledWith("c1", "media", "2026/");
    expect(result.current.usage?.bytes).toBe(5);
  });
});
