import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";

const base = {
  userId: "u", tenantId: "t", username: "u", displayName: "u", isOwner: false,
};

describe("hasPermission", () => {
  it("grants everything to *", () => {
    expect(hasPermission({ ...base, permissions: ["*"] }, "audit:read")).toBe(true);
  });
  it("matches an explicit permission", () => {
    expect(hasPermission({ ...base, permissions: ["ticket:read"] }, "ticket:read")).toBe(true);
  });
  it("denies a missing permission", () => {
    expect(hasPermission({ ...base, permissions: ["ticket:read"] }, "audit:read")).toBe(false);
  });
  it("treats a missing permission list as legacy/allow", () => {
    expect(hasPermission(base, "audit:read")).toBe(true);
  });
});
