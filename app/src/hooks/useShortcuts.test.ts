import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { shortcutOf, useShortcuts } from "./useShortcuts";

function press(init: KeyboardEventInit, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

describe("shortcutOf", () => {
  it("names keys the way the shortcut map does", () => {
    expect(shortcutOf(new KeyboardEvent("keydown", { key: "k", metaKey: true }))).toBe("Mod+K");
    expect(shortcutOf(new KeyboardEvent("keydown", { key: "N", metaKey: true, shiftKey: true }))).toBe("Mod+Shift+N");
    expect(shortcutOf(new KeyboardEvent("keydown", { key: "}", code: "BracketRight", metaKey: true, shiftKey: true }))).toBe("Mod+Shift+]");
    expect(shortcutOf(new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true }))).toBe("Mod+,");
    expect(shortcutOf(new KeyboardEvent("keydown", { key: " ", code: "Space" }))).toBe("Space");
  });
});

describe("useShortcuts", () => {
  it("runs the matching action", () => {
    const open = vi.fn();
    renderHook(() => useShortcuts({ "Mod+K": open }, true));
    press({ key: "k", metaKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("never fires while typing or when turned off", () => {
    const open = vi.fn();
    const { rerender } = renderHook(({ on }) => useShortcuts({ "Mod+K": open, Space: open }, on), { initialProps: { on: true } });
    const field = document.createElement("input");
    document.body.append(field);
    press({ key: "k", metaKey: true }, field);
    press({ key: " ", code: "Space" }, field);
    rerender({ on: false });
    press({ key: "k", metaKey: true });
    expect(open).not.toHaveBeenCalled();
    field.remove();
  });
});
