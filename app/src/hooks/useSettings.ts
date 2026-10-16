import { useCallback, useEffect, useState } from "react";
import { api, type Settings, type Theme } from "../lib/tauri";
import { applyTheme } from "../lib/theme";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({ theme: "system" });

  useEffect(() => {
    api
      .getSettings()
      .then((loaded) => {
        setSettings(loaded);
        applyTheme(loaded.theme);
      })
      .catch(() => undefined);
  }, []);

  const setTheme = useCallback(async (theme: Theme) => {
    applyTheme(theme);
    setSettings((current) => ({ ...current, theme }));
    await api.setSettings({ theme });
  }, []);

  return { settings, setTheme };
}
