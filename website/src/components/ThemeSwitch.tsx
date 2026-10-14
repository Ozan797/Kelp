import { useEffect, useState, type ReactNode } from "react";
import { getThemePreference, setThemePreference, type ThemePreference } from "../../../design/theme";

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {children}
  </svg>
);

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: "system",
    label: "System",
    icon: icon(
      <>
        <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
        <path d="M5.5 14h5M8 11.5V14" />
      </>,
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: icon(
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
      </>,
    ),
  },
  { value: "dark", label: "Dark", icon: icon(<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />) },
];

export function ThemeSwitch() {
  // Start as "system" so the prerendered HTML and the first client render match.
  // The saved choice is read after hydration. The <head> script has already applied it visually.
  const [pref, setPref] = useState<ThemePreference>("system");
  useEffect(() => setPref(getThemePreference()), []);

  return (
    <fieldset className="theme-switch">
      <legend className="visually-hidden">Theme</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} title={option.label}>
          <input
            className="visually-hidden"
            type="radio"
            name="theme"
            value={option.value}
            checked={pref === option.value}
            onChange={() => {
              setThemePreference(option.value);
              setPref(option.value);
            }}
          />
          {option.icon}
          <span className="visually-hidden">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
