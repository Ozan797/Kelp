import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal stand-ins for the browser objects theme.ts touches.
const store = new Map<string, string>();
let storageBroken = false;
const root = { dataset: {} as Record<string, string | undefined> };

function guard() {
  if (storageBroken) throw new Error("SecurityError: storage is blocked");
}

Object.assign(globalThis, {
  document: { documentElement: root },
  localStorage: {
    getItem: (k: string) => (guard(), store.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void store.set(k, v)),
    removeItem: (k: string) => (guard(), void store.delete(k)),
  },
});

const { getThemePreference, setThemePreference } = await import("./theme.ts");

beforeEach(() => {
  store.clear();
  storageBroken = false;
  delete root.dataset.theme;
});

test("defaults to system", () => {
  assert.equal(getThemePreference(), "system");
});

test("dark is applied to <html> and remembered", () => {
  setThemePreference("dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(store.get("kelp-theme"), "dark");
  assert.equal(getThemePreference(), "dark");
});

test("system removes the attribute and the stored value", () => {
  setThemePreference("light");
  setThemePreference("system");
  assert.equal(root.dataset.theme, undefined);
  assert.equal(store.has("kelp-theme"), false);
  assert.equal(getThemePreference(), "system");
});

test("an unknown stored value falls back to system", () => {
  store.set("kelp-theme", "purple");
  assert.equal(getThemePreference(), "system");
});

test("blocked storage falls back to system and still applies the theme", () => {
  storageBroken = true;
  assert.equal(getThemePreference(), "system");
  setThemePreference("dark");
  assert.equal(root.dataset.theme, "dark");
});
