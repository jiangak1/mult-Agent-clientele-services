"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type ThemeId = "dark" | "light" | "red" | "gray" | "blue";

interface ThemeMeta {
  id: ThemeId;
  nameZh: string;
  nameEn: string;
}

export const themes: ThemeMeta[] = [
  { id: "dark",  nameZh: "深黑", nameEn: "Dark" },
  { id: "light", nameZh: "亮白", nameEn: "Light" },
  { id: "red",   nameZh: "酒红", nameEn: "Red" },
  { id: "gray",  nameZh: "岩灰", nameEn: "Gray" },
  { id: "blue",  nameZh: "深海蓝", nameEn: "Blue" },
];

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  themes: ThemeMeta[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("csp-theme");
  if (stored && themes.some((t) => t.id === stored)) return stored as ThemeId;
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setThemeState(getStoredTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("csp-theme", theme);
    }
  }, [theme, mounted]);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
