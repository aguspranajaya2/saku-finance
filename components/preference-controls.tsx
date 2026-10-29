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
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {theme === "dark" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" />}
        </svg>
      </button>}
    </div>
  );
}
