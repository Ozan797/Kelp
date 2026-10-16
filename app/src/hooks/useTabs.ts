import { useReducer } from "react";
import type { Place } from "../lib/drop";

export type Tab = { id: string; connectionId: string | null; place: Place | null };
export type TabsState = { tabs: Tab[]; activeId: string };
export type TabsAction =
  | { type: "open"; id: string }
  | { type: "close"; id: string }
  | { type: "select"; id: string }
  | { type: "next" }
  | { type: "previous" }
  | { type: "update"; id: string; patch: Partial<Omit<Tab, "id">> };

function samePlace(a: Place | null, b: Place | null): boolean {
  return a?.bucket === b?.bucket && a?.prefix === b?.prefix;
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  const at = state.tabs.findIndex((tab) => tab.id === state.activeId);
  switch (action.type) {
    case "open": {
      const current = state.tabs[at];
      const tab = { id: action.id, connectionId: current?.connectionId ?? null, place: current?.place ?? null };
      return { tabs: [...state.tabs.slice(0, at + 1), tab, ...state.tabs.slice(at + 1)], activeId: action.id };
    }
    case "close": {
      if (state.tabs.length === 1) return state;
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const activeId = action.id === state.activeId ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId;
      return { tabs, activeId };
    }
    case "select":
      return state.tabs.some((tab) => tab.id === action.id) ? { ...state, activeId: action.id } : state;
    case "next":
      return { ...state, activeId: state.tabs[(at + 1) % state.tabs.length].id };
    case "previous":
      return { ...state, activeId: state.tabs[(at - 1 + state.tabs.length) % state.tabs.length].id };
    case "update": {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab) return state;
      const next = { ...tab, ...action.patch };
      if (next.connectionId === tab.connectionId && samePlace(next.place, tab.place)) return state;
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? next : t)) };
    }
  }
}

let counter = 0;
export const newTabId = () => `tab-${(counter += 1)}`;

export function useTabs() {
  return useReducer(tabsReducer, undefined, () => {
    const id = newTabId();
    return { tabs: [{ id, connectionId: null, place: null }], activeId: id };
  });
}
