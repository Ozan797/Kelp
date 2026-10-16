import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRowDrag } from "./useRowDrag";

const here = { bucket: "media", prefix: "vimeo/" };

function setup() {
  document.body.innerHTML = '<div data-drop="folder" data-key="vimeo/drafts/"><span id="spot"></span></div>';
  document.elementFromPoint = vi.fn(() => document.getElementById("spot"));
  const onDrop = vi.fn();
  const hook = renderHook(() => useRowDrag({ open: here, connectionId: "c1", onDrop }));
  return { onDrop, hook };
}

function move(x: number, y: number, init: PointerEventInit = {}) {
  act(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, ...init }));
  });
}

afterEach(() => vi.restoreAllMocks());

describe("useRowDrag", () => {
  it("starts only after the pointer moves 4 px, then drops on the target", () => {
    const { onDrop, hook } = setup();
    act(() => hook.result.current.begin(["vimeo/a.mp4", "vimeo/b.mp4"], 10, 10));
    move(12, 12, { buttons: 1 });
    expect(hook.result.current.drag).toBeNull();
    move(20, 20, { buttons: 1 });
    expect(hook.result.current.drag).toMatchObject({ keys: ["vimeo/a.mp4", "vimeo/b.mp4"], x: 20, y: 20 });
    expect(hook.result.current.drag?.target).toEqual({ kind: "place", place: { bucket: "media", prefix: "vimeo/drafts/" } });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 20, clientY: 20 }));
    });
    expect(onDrop).toHaveBeenCalledWith(["vimeo/a.mp4", "vimeo/b.mp4"], { kind: "place", place: { bucket: "media", prefix: "vimeo/drafts/" } }, false);
    expect(hook.result.current.drag).toBeNull();
  });

  it("copies instead of moving when Option is held at the drop", () => {
    const { onDrop, hook } = setup();
    act(() => hook.result.current.begin(["vimeo/a.mp4"], 0, 0));
    move(30, 30, { buttons: 1 });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 30, clientY: 30, altKey: true }));
    });
    expect(onDrop.mock.calls[0][2]).toBe(true);
  });

  it("never drags when no button is held, as after a ctrl-click menu or a lost release", () => {
    const { onDrop, hook } = setup();
    act(() => hook.result.current.begin(["vimeo/a.mp4"], 0, 0));
    move(30, 30, { buttons: 0 });
    expect(hook.result.current.drag).toBeNull();
    move(60, 60, { buttons: 1 });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 60, clientY: 60 }));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does nothing for a plain click, and Escape cancels a drag", () => {
    const { onDrop, hook } = setup();
    act(() => hook.result.current.begin(["vimeo/a.mp4"], 0, 0));
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 1, clientY: 1 }));
    });
    act(() => hook.result.current.begin(["vimeo/a.mp4"], 0, 0));
    move(30, 30, { buttons: 1 });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(hook.result.current.drag).toBeNull();
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 30, clientY: 30 }));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
