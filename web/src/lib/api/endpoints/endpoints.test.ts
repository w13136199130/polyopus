import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINT_GROUPS } from "./index";

// cwd is web/ under `pnpm --dir web test`
const IMPLEMENTED = JSON.parse(
  readFileSync(resolve(process.cwd(), "../schemas/api/implemented.json"), "utf-8"),
) as { count: number; ops: Array<{ method: string; path: string }> };

describe("endpoint whitelist (P0-2: contract types != implementation)", () => {
  it("every wrapper route is implemented by the backend", () => {
    const implemented = new Set(
      IMPLEMENTED.ops.map((op) => `${op.method} ${op.path}`),
    );
    expect(implemented.size).toBeGreaterThan(0);

    const routed: Array<[string, string]> = [];
    for (const group of ENDPOINT_GROUPS) {
      for (const wrapper of Object.values(group)) {
        routed.push(wrapper.route);
      }
    }
    // 35 implemented ops - /healthz - SSE events endpoint - endpoints the UI
    // does not wrap yet (admin/audit, outbox) = 26 wrappers
    expect(routed.length).toBe(26);

    for (const [method, path] of routed) {
      const full = path.startsWith("/api/") || path === "/healthz"
        ? path
        : `/api/v1${path}`;
      expect(
        implemented.has(`${method} ${full}`),
        `${method} ${full} is not in schemas/api/implemented.json — the backend does not serve it`,
      ).toBe(true);
    }
  });
});
