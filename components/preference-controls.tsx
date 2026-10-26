"use client";

import { usePreferences } from "@/lib/preferences";

export function PreferenceControls({ className = "", showLanguage = true, showTheme = true }: { className?: string; showLanguage?: boolean; showTheme?: boolean }) {
  const { language, theme, setLanguage, toggleTheme } = usePreferences();
  const darkModeLabel = language === "en"
    ? (theme === "dark" ? "Switch to light mode" : "Switch to dark mode")
    : (theme === "dark" ? "Ganti ke mode terang" : "Ganti ke mode gelap");

  return (
    <div className={`preference-controls ${className}`.trim()}>
      {showLanguage && <label className="language-control">
        <span className="visually-hidden">{language === "en" ? "Language" : "Bahasa"}</span>
        <select
          aria-label={language === "en" ? "Language" : "Bahasa"}
          className="language-select"
          onChange={(event) => setLanguage(event.target.value as "en" | "id")}
          value={language}
        >
          <option value="en">EN</option>
          <option value="id">ID</option>
        </select>
      </label>}
      {showTheme && <button
        aria-label={darkModeLabel}
        aria-pressed={theme === "dark"}
        className="theme-toggle"
        onClick={toggleTheme}
        title={darkModeLabel}
        type="button"
      >
        <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      </button>}
    </div>
  );
}
