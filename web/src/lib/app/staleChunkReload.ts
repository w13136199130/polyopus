/**
 * Deploy-time stale chunk recovery (docs/49 §12): after a new build, an old
 * tab may request a deleted hashed chunk. Reload ONCE per session — never
 * loop (the same guard flag blocks the second attempt).
 */
const RELOAD_FLAG = "poly:chunk-reload";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function tryReloadOnce(storage: StorageLike): boolean {
  if (storage.getItem(RELOAD_FLAG) === "1") {
    storage.removeItem(RELOAD_FLAG);
    return false;
  }
  storage.setItem(RELOAD_FLAG, "1");
  return true;
}

export function installStaleChunkReload(
  target: { addEventListener(type: string, listener: () => void): void } = window,
  storage: StorageLike = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): void {
  target.addEventListener("vite:preloadError", () => {
    if (tryReloadOnce(storage)) reload();
  });
}
