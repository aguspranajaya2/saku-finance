"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "en" | "id";
export type ColorTheme = "light" | "dark";

type PreferencesContextValue = {
  language: Language;
  theme: ColorTheme;
  amountsHidden: boolean;
  toggleAmounts: () => void;
  setLanguage: (language: Language) => void;
  toggleTheme: () => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  const [theme, setThemeState] = useState<ColorTheme>("light");
  // Hide before preferences load so a saved privacy choice never flashes amounts.
  const [amountsHidden, setAmountsHidden] = useState(true);

  useEffect(() => {
    try {
    const savedLanguage = window.localStorage.getItem("saku-language");
    const savedTheme = window.localStorage.getItem("saku-theme");
    if (savedLanguage === "id" || savedLanguage === "en") setLanguageState(savedLanguage);
    if (savedTheme === "dark" || savedTheme === "light") setThemeState(savedTheme);
    setAmountsHidden(window.localStorage.getItem("saku-amounts-hidden") !== "false");
    } catch { /* Privacy remains enabled if browser storage is unavailable. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
  }, [language, theme]);

  const value = useMemo<PreferencesContextValue>(() => ({
    language,
    theme,
    amountsHidden,
    toggleAmounts() {
      setAmountsHidden(current => {
        const next = !current;
        try { window.localStorage.setItem("saku-amounts-hidden", String(next)); } catch { /* Current tab still works. */ }
        return next;
      });
    },
    setLanguage(nextLanguage) {
      window.localStorage.setItem("saku-language", nextLanguage);
      setLanguageState(nextLanguage);
    },
    toggleTheme() {
      setThemeState((currentTheme) => {
        const nextTheme = currentTheme === "dark" ? "light" : "dark";
        window.localStorage.setItem("saku-theme", nextTheme);
        return nextTheme;
      });
    },
  }), [language, theme, amountsHidden]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used within PreferencesProvider");
  return value;
}
