import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type DropSummary, type FileDropEvent } from "../lib/tauri";
import { useFileDrop } from "./useFileDrop";

const open = { bucket: "media", prefix: "vimeo/" };

function setup() {
  let emit: (event: FileDropEvent) => void = () => undefined;
  vi.spyOn(api, "onFileDrop").mockImplementation(async (handler) => {
    emit = handler;
    return () => undefined;
  });
  document.body.innerHTML = '<div data-drop="list"><span id="spot"></span></div>';
  document.elementFromPoint = vi.fn(() => document.getElementById("spot"));
  return { emit: (event: FileDropEvent) => act(() => emit(event)) };
}

afterEach(() => vi.restoreAllMocks());

describe("useFileDrop", () => {
  it("keeps the same drag while the pointer stays over the same target", async () => {
    const { emit } = setup();
    vi.spyOn(api, "inspectDrop").mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useFileDrop(open, vi.fn()));
    await act(async () => undefined);
    emit({ type: "enter", paths: ["/u/a"], x: 1, y: 1 });
    const first = result.current;
    emit({ type: "over", x: 2, y: 2 });
    emit({ type: "over", x: 3, y: 3 });
    expect(result.current).toBe(first);
  });

  it("only shows the size counted for the current drag", async () => {
    const { emit } = setup();
    const answers: ((summary: DropSummary) => void)[] = [];
    vi.spyOn(api, "inspectDrop").mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result } = renderHook(() => useFileDrop(open, vi.fn()));
    await act(async () => undefined);
    emit({ type: "enter", paths: ["/u/big"], x: 1, y: 1 });
    emit({ type: "leave" });
    emit({ type: "enter", paths: ["/u/small"], x: 1, y: 1 });
    await act(async () => answers[0]({ files: 999, folders: 1, bytes: 9, loose: 0 }));
    expect(result.current?.summary).toBeNull();
    await act(async () => answers[1]({ files: 1, folders: 0, bytes: 1, loose: 1 }));
    expect(result.current?.summary?.files).toBe(1);
  });
});
