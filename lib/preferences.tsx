"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "en" | "id";
export type ColorTheme = "light" | "dark";

type PreferencesContextValue = {
  language: Language;
  theme: ColorTheme;
  setLanguage: (language: Language) => void;
  toggleTheme: () => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  const [theme, setThemeState] = useState<ColorTheme>("light");

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("saku-language");
    const savedTheme = window.localStorage.getItem("saku-theme");
    if (savedLanguage === "id" || savedLanguage === "en") setLanguageState(savedLanguage);
    if (savedTheme === "dark" || savedTheme === "light") setThemeState(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
  }, [language, theme]);

  const value = useMemo<PreferencesContextValue>(() => ({
    language,
    theme,
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
  }), [language, theme]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used within PreferencesProvider");
  return value;
}
