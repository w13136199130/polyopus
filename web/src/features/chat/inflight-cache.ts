/**
 * Streaming tail cache (V05-23): a debounced sessionStorage copy of the
 * in-flight assistant text, so a refresh can repaint before the replay
 * catches up. Scoped per thread and keyed by the server user-message id;
 * bounded per entry (80k chars) and in total (1.5M chars).
 */

export interface InflightEntry {
  threadId: string;
  userMessageId: string;
  turnId: string;
  text: string;
  seq: number;
  status: "optimistic" | "streaming" | "waiting_approval";
  updatedAt: number;
}

export type InflightDraft = Omit<InflightEntry, "updatedAt"> & {
  updatedAt?: number;
};

const PREFIX = "poly:inflight:";
const MAX_TEXT_CHARS = 80_000;
const MAX_TOTAL_CHARS = 1_500_000;
const MAX_AGE_MS = 10 * 60_000;
const DEBOUNCE_MS = 200;

const pending = new Map<string, InflightEntry>();
let timer: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // private mode / disabled storage
  }
}

function trim(): void {
  const store = storage();
  if (!store) return;
  const keys: Array<{ key: string; at: number; size: number }> = [];
  let total = 0;
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const raw = store.getItem(key) ?? "";
    total += raw.length;
    let at = 0;
    try {
      at = Number((JSON.parse(raw) as InflightEntry).updatedAt) || 0;
    } catch {
      at = 0;
    }
    keys.push({ key, at, size: raw.length });
  }
  keys.sort((a, b) => a.at - b.at);
  for (const item of keys) {
    if (total <= MAX_TOTAL_CHARS) break;
    store.removeItem(item.key);
    total -= item.size;
  }
}

/** Queue one entry; writes coalesce on a 200ms timer. */
export function saveInflight(entry: InflightDraft): void {
  pending.set(entry.threadId, {
    ...entry,
    text: entry.text.slice(-MAX_TEXT_CHARS),
    updatedAt: Date.now(),
  });
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushInflight();
  }, DEBOUNCE_MS);
}

/** Force the pending entries out (pagehide, turn end, tests). */
export function flushInflight(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const store = storage();
  if (!store) {
    pending.clear();
    return;
  }
  for (const [threadId, entry] of pending) {
    try {
      store.setItem(PREFIX + threadId, JSON.stringify(entry));
    } catch {
      // quota: drop the oldest entries and retry once
      trim();
      try {
        store.setItem(PREFIX + threadId, JSON.stringify(entry));
      } catch {
        // give up: the replay is still authoritative
      }
    }
  }
  pending.clear();
  trim();
}

export function loadInflight(threadId: string): InflightEntry | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(PREFIX + threadId);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as InflightEntry;
    if (entry.threadId !== threadId || !entry.turnId) return null;
    if (Date.now() - Number(entry.updatedAt || 0) > MAX_AGE_MS) {
      store.removeItem(PREFIX + threadId);
      return null;
    }
    return { ...entry, text: String(entry.text ?? "").slice(-MAX_TEXT_CHARS) };
  } catch {
    store.removeItem(PREFIX + threadId);
    return null;
  }
}

export function clearInflight(threadId: string): void {
  pending.delete(threadId);
  storage()?.removeItem(PREFIX + threadId);
}

/** Test hook: drop timers/pending without touching sessionStorage. */
export function resetInflightForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushInflight);
}

export const INFLIGHT_LIMITS = {
  maxTextChars: MAX_TEXT_CHARS,
  maxTotalChars: MAX_TOTAL_CHARS,
  debounceMs: DEBOUNCE_MS,
} as const;
