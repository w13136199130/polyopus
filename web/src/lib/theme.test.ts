import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, readTheme, toggleTheme } from "./theme";

afterEach(() => {
  document.documentElement.dataset.theme = "dark";
  localStorage.clear();
});

describe("theme module", () => {
  it("reads the current theme from data-theme", () => {
    applyTheme("light");
    expect(readTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists the explicit choice", () => {
    applyTheme("dark");
    expect(localStorage.getItem("poly:theme")).toBe("dark");
  });

  it("toggles both ways and returns the new theme", () => {
    applyTheme("dark");
    expect(toggleTheme()).toBe("light");
    expect(toggleTheme()).toBe("dark");
  });

  it("falls back to dark for unknown values", () => {
    document.documentElement.dataset.theme = "nonsense";
    expect(readTheme()).toBe("dark");
  });
});
