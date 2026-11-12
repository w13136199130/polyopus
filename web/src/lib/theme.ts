/**
 * Theme (docs/49 §9): light/dark only in v0.5. `data-theme` on <html> is the
 * single source; index.html sets it pre-paint, this module is the runtime
 * switch. Explicit choice persists; private-mode failures degrade silently.
 */

const THEME_KEY = "poly:theme";

export type Theme = "light" | "dark";

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: visual toggle still works for this tab */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = readTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
