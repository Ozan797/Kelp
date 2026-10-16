import { api, type Theme } from "./tauri";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  api.setWindowTheme(theme === "system" ? null : theme).catch(() => undefined);
}
