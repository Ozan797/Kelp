import { describe, expect, it } from "vitest";
import { tabsReducer, type TabsState } from "./useTabs";

const start: TabsState = { tabs: [{ id: "a", connectionId: "c1", place: { bucket: "media", prefix: "vimeo/" } }], activeId: "a" };

describe("tabsReducer", () => {
  it("opens a tab on the same connection and place, next to the current one", () => {
    const opened = tabsReducer(start, { type: "open", id: "b" });
    expect(opened.activeId).toBe("b");
    expect(opened.tabs[1]).toEqual({ id: "b", connectionId: "c1", place: { bucket: "media", prefix: "vimeo/" } });
  });

  it("selects a neighbour when the active tab closes, and keeps the last tab", () => {
    let state = tabsReducer(start, { type: "open", id: "b" });
    state = tabsReducer(state, { type: "open", id: "c" });
    state = tabsReducer(state, { type: "select", id: "b" });
    state = tabsReducer(state, { type: "close", id: "b" });
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(state.activeId).toBe("c");
    state = tabsReducer(state, { type: "close", id: "c" });
    expect(state.activeId).toBe("a");
    expect(tabsReducer(state, { type: "close", id: "a" })).toBe(state);
  });

  it("moves to the next and previous tab, wrapping around", () => {
    let state = tabsReducer(start, { type: "open", id: "b" });
    state = tabsReducer(state, { type: "next" });
    expect(state.activeId).toBe("a");
    state = tabsReducer(state, { type: "previous" });
    expect(state.activeId).toBe("b");
  });

  it("updates one tab's connection or place", () => {
    const state = tabsReducer(start, { type: "update", id: "a", patch: { connectionId: "c2", place: null } });
    expect(state.tabs[0]).toEqual({ id: "a", connectionId: "c2", place: null });
  });
});
