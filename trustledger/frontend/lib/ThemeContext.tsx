"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  ReactNode,
} from "react";

export type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "pramaan-theme";

function getClientTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("trustledger-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function getServerTheme(): Theme {
  return "dark";
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void) {
  listeners.add(callback);

  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      callback();
    }
  };
  window.addEventListener("storage", handleStorage);

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handleMql = () => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      callback();
    }
  };
  mql.addEventListener("change", handleMql);

  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", handleStorage);
    mql.removeEventListener("change", handleMql);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    getClientTheme,
    getServerTheme
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {}
    document.documentElement.setAttribute("data-theme", newTheme);
    notify();
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
