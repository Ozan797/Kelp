/**
 * Theme preference shared by the Kelp website and app.
 * "system" follows macOS. "light" and "dark" override it and are remembered.
 * The CSS in tokens.css reacts to the `data-theme` attribute on <html>.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "kelp-theme";

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system"; // storage blocked (private browsing, strict settings)
  }
}

export function setThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;

  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Not remembered, but still applied to this page.
  }
}
