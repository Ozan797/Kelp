import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./tauri";
import { applyTheme } from "./theme";

afterEach(() => vi.restoreAllMocks());

describe("applyTheme", () => {
  it("forces light or dark on the page and the title bar", () => {
    const setWindowTheme = vi.spyOn(api, "setWindowTheme").mockResolvedValue(undefined);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(setWindowTheme).toHaveBeenCalledWith("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the system again", () => {
    const setWindowTheme = vi.spyOn(api, "setWindowTheme").mockResolvedValue(undefined);
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(setWindowTheme).toHaveBeenLastCalledWith(null);
  });
});
