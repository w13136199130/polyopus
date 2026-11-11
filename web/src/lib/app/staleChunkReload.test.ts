import { describe, expect, it } from "vitest";
import { tryReloadOnce } from "./staleChunkReload";

function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage & { map: Map<string, string> };
}

describe("stale chunk reload guard", () => {
  it("reloads once, then refuses (no loop)", () => {
    const storage = memoryStorage();
    expect(tryReloadOnce(storage)).toBe(true);
    expect(tryReloadOnce(storage)).toBe(false); // second attempt gives up
    expect(storage.getItem("poly:chunk-reload")).toBeNull();
  });

  it("can re-arm after a successful boot clears the flag", () => {
    const storage = memoryStorage();
    expect(tryReloadOnce(storage)).toBe(true);
    expect(tryReloadOnce(storage)).toBe(false);
    expect(tryReloadOnce(storage)).toBe(true); // armed again for the next deploy
  });
});
