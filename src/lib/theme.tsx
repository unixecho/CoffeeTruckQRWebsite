"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Light/dark, as an explicit choice rather than a system-preference guess.
 *
 * Dark is the default look (see `globals.css`) — nothing here needs to run
 * for a first-time visitor to see it. This only matters once someone opts
 * into light, which is why the persisted value is `"light" | null`: `null`
 * means "no override, stay on the default," not "unknown."
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "coffeetruck-theme";

/**
 * `useSyncExternalStore` rather than "read localStorage into `useState`,
 * fix it up in an effect" — a server render can't know a visitor's stored
 * choice, so the two would disagree on the very first client render and
 * fail hydration. This is the API React actually built for that: render
 * the server's snapshot ("dark") through hydration, then resync to the
 * real one — a listener-free store, since only `setTheme` below ever
 * changes it.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

/** Mirrors the choice onto `<html data-theme>`, which is what the CSS reads. */
function apply(theme: Theme) {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (next: Theme) => void }>({
  theme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  function setTheme(next: Theme) {
    if (next === "light") {
      window.localStorage.setItem(STORAGE_KEY, "light");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    listeners.forEach((listener) => listener());
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

/** Read once, synchronously, before React hydrates — avoids a flash of the wrong theme. */
export const THEME_NO_FLASH_SCRIPT = `
try {
  if (localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) === "light") {
    document.documentElement.dataset.theme = "light";
  }
} catch (e) {}
`;
