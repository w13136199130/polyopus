/**
 * Appearance preferences (docs/49 §9): theme choice (light/dark/system),
 * accent palette, density. `data-theme` / `data-palette` / `data-density`
 * on <html> are the single source; explicit choices persist in localStorage.
 */

const THEME_KEY = "poly:theme";
const PALETTE_KEY = "poly:palette";
const ACCENT_KEY = "poly:accent";
const DENSITY_KEY = "poly:density";

export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "system";
export type Density = "default" | "compact";

export interface Palette {
  id: string;
  label: string;
  color: string;
}

export const PALETTES: Palette[] = [
  { id: "tech", label: "科技", color: "#1677ff" },
  { id: "rose", label: "玫瑰", color: "#e11d48" },
  { id: "indigo", label: "靛蓝", color: "#4f46e5" },
  { id: "teal", label: "青绿", color: "#0d9488" },
  { id: "violet", label: "紫罗兰", color: "#7c3aed" },
  { id: "emerald", label: "翠绿", color: "#059669" },
  { id: "amber", label: "琥珀", color: "#d97706" },
  { id: "slate", label: "石墨", color: "#475569" },
];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the visual change still applies for this tab */
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

export function readThemeChoice(): ThemeChoice {
  const raw = read(THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/** Resolved theme currently applied to the document. */
export function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === "system" ? systemTheme() : choice;
}

export function applyThemeChoice(choice: ThemeChoice): Theme {
  const theme = resolveTheme(choice);
  document.documentElement.dataset.theme = theme;
  write(THEME_KEY, choice);
  return theme;
}

/** Explicit light/dark apply (kept for existing callers/tests). */
export function applyTheme(theme: Theme): void {
  applyThemeChoice(theme);
}

/** Backwards-compatible switch used by the sidebar: flips the resolved theme. */
export function toggleTheme(): Theme {
  const next: Theme = readTheme() === "dark" ? "light" : "dark";
  applyThemeChoice(next);
  return next;
}

export function readPalette(): string {
  return read(PALETTE_KEY) ?? "tech";
}

export function readAccent(): string {
  return read(ACCENT_KEY) ?? "#1677ff";
}

function mix(
  color: string,
  percent: number,
  target: "white" | "black" | "surface",
): string {
  const against = target === "white"
    ? "#ffffff"
    : target === "black"
      ? "#000000"
      : "var(--surface)";
  return `color-mix(in srgb, ${color} ${percent}%, ${against})`;
}

export function applyPalette(palette: string, accent?: string): void {
  const root = document.documentElement;
  root.dataset.palette = palette;
  write(PALETTE_KEY, palette);
  if (palette === "custom") {
    const color = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : readAccent();
    write(ACCENT_KEY, color);
    root.style.setProperty("--primary", color);
    root.style.setProperty("--primary-hover", mix(color, 82, "white"));
    root.style.setProperty("--primary-active", mix(color, 86, "black"));
    root.style.setProperty("--primary-soft", mix(color, 12, "surface"));
    root.style.setProperty("--primary-border", mix(color, 36, "surface"));
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-hover");
    root.style.removeProperty("--primary-active");
    root.style.removeProperty("--primary-soft");
    root.style.removeProperty("--primary-border");
  }
}

export function readDensity(): Density {
  return read(DENSITY_KEY) === "compact" ? "compact" : "default";
}

export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
  write(DENSITY_KEY, density);
}

let listening = false;

/** Apply persisted appearance once at boot; keeps system theme in sync. */
export function initAppearance(): void {
  const choice = readThemeChoice();
  applyThemeChoice(choice);
  applyPalette(readPalette(), readAccent());
  applyDensity(readDensity());
  if (listening || typeof window === "undefined") return;
  listening = true;
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener(
      "change",
      () => {
        if (readThemeChoice() === "system") applyThemeChoice("system");
      },
    );
  } catch {
    /* older browser: system theme simply does not live-update */
  }
}
