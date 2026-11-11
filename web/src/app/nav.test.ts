import { describe, expect, it } from "vitest";
import { NAV_BOTTOM, NAV_PRIMARY } from "./nav";
import { appRoutes, flattenPaths } from "./router";

describe("navigation model (8+3)", () => {
  it("has exactly 8 primary entries", () => {
    expect(NAV_PRIMARY).toHaveLength(8);
  });

  it("has settings + admin at the bottom", () => {
    expect(NAV_BOTTOM.map((item) => item.path)).toEqual(["/settings", "/admin"]);
  });

  it("paths are unique and absolute", () => {
    const all = [...NAV_PRIMARY, ...NAV_BOTTOM].map((item) => item.path);
    expect(new Set(all).size).toBe(all.length);
    for (const path of all) expect(path.startsWith("/")).toBe(true);
  });

  it("every nav path has a matching route", () => {
    const routed = new Set(flattenPaths(appRoutes));
    for (const item of [...NAV_PRIMARY, ...NAV_BOTTOM]) {
      expect(routed.has(item.path), `route missing for ${item.path}`).toBe(true);
    }
  });

  it("every icon resolves to a known glyph", async () => {
    const icons = (await import("@/layouts/icons")).default;
    const names = Object.keys(icons) as string[];
    for (const item of [...NAV_PRIMARY, ...NAV_BOTTOM]) {
      expect(names, `icon missing for ${item.icon}`).toContain(item.icon);
    }
  });
});
