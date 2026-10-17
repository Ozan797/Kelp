import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PendingUpdate } from "../lib/tauri";
import { CHECK_EVERY_MS, CHECK_FAILED, INSTALL_FAILED, UPDATES_OFF, restartQuestion, upToDate, useUpdater } from "./useUpdater";

const pending = (version: string, install = vi.fn(async () => undefined)): PendingUpdate => ({ version, notes: "Notes", install });

let menuCheck: () => void = () => undefined;
let focused: () => void = () => undefined;

beforeEach(() => {
  vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
  vi.spyOn(api, "restartApp").mockResolvedValue(undefined);
  vi.spyOn(api, "onCheckForUpdates").mockImplementation(async (handler) => {
    menuCheck = handler;
    return () => undefined;
  });
  vi.spyOn(api, "onWindowFocus").mockImplementation(async (handler) => {
    focused = handler;
    return () => undefined;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useUpdater", () => {
  it("a_found_update_shows_the_indicator_not_the_card", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.ready?.version).toBe("0.2.0"));
    expect(result.current.cardOpen).toBe(false);
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
    expect(result.current.ready).toBeNull();
    expect(result.current.message).toBeNull();
    expect(result.current.cardOpen).toBe(false);
  });

  it("checks_every_30_minutes", async () => {
    const found = vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    expect(CHECK_EVERY_MS).toBe(30 * 60 * 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    expect(found).toHaveBeenCalledTimes(2);
  });

  it("checks_on_focus_after_30_minutes", async () => {
    const found = vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.onWindowFocus).toHaveBeenCalled());
    await act(async () => focused());
    expect(found).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + CHECK_EVERY_MS + 60_000);
    await act(async () => focused());
    await waitFor(() => expect(found).toHaveBeenCalledTimes(2));
  });

  it("check_now_opens_the_card", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValueOnce(pending("0.2.0")).mockResolvedValue(null);
    const first = renderHook(() => useUpdater(true));
    await waitFor(() => expect(first.result.current.ready).not.toBeNull());
    act(() => first.result.current.checkNow());
    await waitFor(() => expect(first.result.current.cardOpen).toBe(true));
    expect(first.result.current.ready?.version).toBe("0.2.0");

    vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    const second = renderHook(() => useUpdater(true));
    await waitFor(() => expect(api.checkForUpdate).toHaveBeenCalled());
    act(() => second.result.current.checkNow());
    await waitFor(() => expect(second.result.current.message).toBe(upToDate("0.1.0")));
    expect(second.result.current.cardOpen).toBe(true);
  });

  it("answers a manual check that fails, and the menu item does the same", async () => {
    vi.spyOn(api, "checkForUpdate").mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(api.onCheckForUpdates).toHaveBeenCalled());
    act(() => menuCheck());
    await waitFor(() => expect(result.current.message).toBe(CHECK_FAILED));
    expect(result.current.cardOpen).toBe(true);
    act(() => result.current.closeCard());
    expect(result.current.message).toBeNull();
    expect(result.current.cardOpen).toBe(false);
  });

  it("a_manual_check_during_a_timed_check_shares_it", async () => {
    let finish: (value: PendingUpdate | null) => void = () => undefined;
    const found = vi.spyOn(api, "checkForUpdate").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(1));
    act(() => result.current.checkNow());
    await act(async () => finish(pending("0.2.0")));
    await waitFor(() => expect(result.current.ready).not.toBeNull());
    expect(result.current.cardOpen).toBe(true);
    expect(found).toHaveBeenCalledTimes(1);
  });

  it("dismiss_hides_until_asked", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.ready).not.toBeNull());
    act(() => result.current.dismiss());
    expect(result.current.ready).toBeNull();
    expect(result.current.cardOpen).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    expect(result.current.ready).toBeNull();
    act(() => result.current.checkNow());
    await waitFor(() => expect(result.current.ready?.version).toBe("0.2.0"));
    expect(result.current.cardOpen).toBe(true);
  });

  it("a_newer_version_undoes_a_dismissal", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValueOnce(pending("0.2.0")).mockResolvedValue(pending("0.2.1"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.ready).not.toBeNull());
    act(() => result.current.dismiss());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    });
    await waitFor(() => expect(result.current.ready?.version).toBe("0.2.1"));
    expect(result.current.cardOpen).toBe(false);
  });

  it("restarts after installing", async () => {
    const install = vi.fn(async () => undefined);
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", install));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.ready).not.toBeNull());
    await act(() => result.current.restart(0));
    expect(install).toHaveBeenCalled();
    expect(api.restartApp).toHaveBeenCalled();
  });

  it("asks before restarting while transfers run, and respects Cancel", async () => {
    const install = vi.fn(async () => undefined);
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", install));
    const confirm = vi.spyOn(api, "confirm").mockResolvedValue(false);
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.ready).not.toBeNull());
    await act(() => result.current.restart(3));
    expect(confirm).toHaveBeenCalledWith(restartQuestion(3), "Restart");
    expect(install).not.toHaveBeenCalled();
  });

  it("a_failed_install_says_so", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(pending("0.2.0", vi.fn(async () => Promise.reject(new Error("disk")))));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.ready).not.toBeNull());
    await act(() => result.current.restart(0));
    expect(result.current.message).toBe(INSTALL_FAILED);
    expect(result.current.cardOpen).toBe(true);
    expect(api.restartApp).not.toHaveBeenCalled();
  });

  it("never checks in development builds and says so when asked", async () => {
    const found = vi.spyOn(api, "checkForUpdate");
    const { result } = renderHook(() => useUpdater(false));
    act(() => result.current.checkNow());
    expect(result.current.message).toBe(UPDATES_OFF);
    expect(result.current.cardOpen).toBe(true);
    expect(found).not.toHaveBeenCalled();
  });

  it("words the restart question for one and many transfers", () => {
    expect(restartQuestion(1)).toBe("1 transfer is running. Restart now? It'll resume after Kelp reopens.");
    expect(restartQuestion(3)).toBe("3 transfers are running. Restart now? They'll resume after Kelp reopens.");
  });
});
