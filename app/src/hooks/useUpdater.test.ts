import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PendingUpdate } from "../lib/tauri";
import { CHECK_EVERY_MS, CHECK_FAILED, INSTALL_FAILED, UPDATES_OFF, restartQuestion, upToDate, useUpdater } from "./useUpdater";

const pending = (version: string, install = vi.fn(async () => undefined)): PendingUpdate => ({ version, notes: "Notes", install });

let menuCheck: () => void = () => undefined;

beforeEach(() => {
  vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
  vi.spyOn(api, "restartApp").mockResolvedValue(undefined);
  vi.spyOn(api, "onCheckForUpdates").mockImplementation(async (handler) => {
    menuCheck = handler;
    return () => undefined;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useUpdater", () => {
  it("shows a found update after the launch check", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", update: { version: "0.2.0" } }));
  });

  it("stays quiet when a timed check finds nothing or fails", async () => {
    const found = vi.spyOn(api, "checkForUpdate").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    expect(found).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("answers a manual check that finds nothing", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(api.checkForUpdate).toHaveBeenCalled());
    act(() => result.current.checkNow());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "message", text: upToDate("0.1.0") }));
  });

  it("answers a manual check that fails, and the menu item does the same", async () => {
    vi.spyOn(api, "checkForUpdate").mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(api.onCheckForUpdates).toHaveBeenCalled());
    act(() => menuCheck());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "message", text: CHECK_FAILED }));
  });

  it("a_manual_check_during_a_timed_check_shares_it", async () => {
    let finish: (value: PendingUpdate | null) => void = () => undefined;
    const found = vi.spyOn(api, "checkForUpdate").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    act(() => result.current.checkNow());
    await act(async () => finish(pending("0.2.0")));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(found).toHaveBeenCalledTimes(1);
  });

  it("later_hides_the_same_version_until_asked", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    act(() => result.current.later());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    expect(result.current.state).toEqual({ kind: "idle" });
    act(() => result.current.checkNow());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
  });

  it("restarts after installing", async () => {
    const install = vi.fn(async () => undefined);
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", install));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(() => result.current.restart(0));
    expect(install).toHaveBeenCalled();
    expect(api.restartApp).toHaveBeenCalled();
  });

  it("asks before restarting while transfers run, and respects Cancel", async () => {
    const install = vi.fn(async () => undefined);
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", install));
    const confirm = vi.spyOn(api, "confirm").mockResolvedValue(false);
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(() => result.current.restart(3));
    expect(confirm).toHaveBeenCalledWith(restartQuestion(3), "Restart");
    expect(install).not.toHaveBeenCalled();
  });

  it("a_failed_install_says_so", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", vi.fn(async () => Promise.reject(new Error("disk")))));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(() => result.current.restart(0));
    expect(result.current.state).toEqual({ kind: "message", text: INSTALL_FAILED });
    expect(api.restartApp).not.toHaveBeenCalled();
  });

  it("never checks in development builds and says so when asked", async () => {
    const found = vi.spyOn(api, "checkForUpdate");
    const { result } = renderHook(() => useUpdater(false));
    act(() => result.current.checkNow());
    expect(result.current.state).toEqual({ kind: "message", text: UPDATES_OFF });
    expect(found).not.toHaveBeenCalled();
  });

  it("words the restart question for one and many transfers", () => {
    expect(restartQuestion(1)).toBe("1 transfer is running. Restart now? It'll resume after Kelp reopens.");
    expect(restartQuestion(3)).toBe("3 transfers are running. Restart now? They'll resume after Kelp reopens.");
  });
});
