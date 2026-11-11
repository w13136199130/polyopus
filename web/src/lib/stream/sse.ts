/**
 * fetch-based SSE client (docs/49 §5). Not EventSource: we need the 401
 * status, custom headers and real abort. Reconnects replay from the last
 * seen seq (`after_seq`), dedupe included; a seq jump surfaces as onGap for
 * the caller to snapshot. Unknown event types and malformed frames are
 * ignored — a newer backend must not crash an older UI.
 */

import { fireUnauthorizedOnce, newTraceId } from "@/lib/api/client";
import type { WireEvent } from "@/lib/api/wire";
import { SseParser } from "./parser";
import type { TransportState } from "./transport";

const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000, 16000, 30000] as const;
const TERMINAL_TYPES = new Set(["turn.finished"]);

export interface ConnectEventsOptions {
  threadId: string;
  afterSeq: number;
  signal: AbortSignal;
  onEvent: (event: WireEvent) => void;
  onGap?: (from: number, to: number) => void;
  onState?: (state: TransportState) => void;
  /** Tests inject a fake fetch; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Absolute origin for non-browser runners (Node fetch needs absolute URLs). */
  baseUrl?: string;
  backoffMs?: readonly number[];
  maxRetries?: number;
  staleMs?: number;
  follow?: boolean;
  stopOnTurnFinished?: boolean;
}

export interface EventsConnection {
  close(): void;
  lastSeq(): number;
  /** Resolves when the loop exits (closed / error / unauthorized / finished). */
  done: Promise<TransportState>;
}

export function connectEvents(options: ConnectEventsOptions): EventsConnection {
  const {
    threadId,
    afterSeq,
    signal,
    onEvent,
    onGap,
    onState,
    fetchImpl = fetch,
    baseUrl = "",
    backoffMs = DEFAULT_BACKOFF,
    maxRetries = 8,
    staleMs = 45_000,
    follow = true,
    stopOnTurnFinished = true,
  } = options;

  let lastSeq = afterSeq;
  let closed = false;
  let controller: AbortController | null = null;
  let settle!: (state: TransportState) => void;
  const done = new Promise<TransportState>((resolve) => {
    settle = resolve;
  });

  const state = (s: TransportState) => onState?.(s);
  const stop = (s: TransportState) => {
    if (closed) return;
    closed = true;
    controller?.abort();
    state(s);
    settle(s);
  };

  signal.addEventListener(
    "abort",
    () => stop("closed"),
    { once: true },
  );

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });

  async function attempt(tries: number): Promise<void> {
    controller = new AbortController();
    const url =
      `/api/v1/threads/${encodeURIComponent(threadId)}` +
      `/events?after_seq=${lastSeq}&follow=${follow ? "true" : "false"}`;

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${url}`, {
        credentials: "include",
        headers: { Accept: "text/event-stream", "X-Trace-Id": newTraceId() },
        signal: controller.signal,
      });
    } catch {
      if (closed || signal.aborted) return stop("closed");
      return retry(tries);
    }

    if (response.status === 401) {
      fireUnauthorizedOnce();
      return stop("unauthorized");
    }
    if (!response.ok || !response.body) return retry(tries);

    state("open");
    tries = 0; // a successful connection resets the backoff ladder
    const parser = new SseParser();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    // stale watchdog: no frames (events or pings) within staleMs -> reconnect
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => controller?.abort(), staleMs);
    };
    armStale();

    try {
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        armStale();
        for (const message of parser.feed(value)) {
          armStale();
          if (closed || signal.aborted) return stop("closed");
          if (!message.data) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(message.data);
          } catch {
            continue; // tolerate malformed payloads
          }
          const event = parsed as Partial<WireEvent>;
          const seq = Number(event.seq);
          if (!Number.isFinite(seq) || typeof event.type !== "string") continue;
          if (seq <= lastSeq) continue; // dedupe across reconnects
          if (seq > lastSeq + 1) onGap?.(lastSeq + 1, seq - 1);
          lastSeq = seq;
          onEvent({
            seq,
            type: event.type,
            ts: Number(event.ts) || 0,
            turnId: event.turnId,
            payload: (event.payload ?? {}) as Record<string, unknown>,
          });
          if (stopOnTurnFinished && TERMINAL_TYPES.has(event.type)) {
            if (staleTimer) clearTimeout(staleTimer);
            return stop("closed");
          }
        }
      }
    } catch {
      // aborted (stale or close) or network error — fall through to retry
    } finally {
      if (staleTimer) clearTimeout(staleTimer);
    }

    if (closed || signal.aborted) return stop("closed");
    if (!follow) return stop("closed"); // finite replay ended
    return retry(0); // EOF on a follow stream means the server dropped us
  }

  async function retry(attemptSoFar: number): Promise<void> {
    const next = attemptSoFar + 1;
    if (next > maxRetries) return stop("error");
    state("reconnecting");
    await wait(backoffMs[Math.min(next - 1, backoffMs.length - 1)]!);
    if (closed || signal.aborted) return stop("closed");
    await attempt(next);
  }

  state("connecting");
    void attempt(0).catch(() => stop("error"));

  return {
    close: () => stop("closed"),
    lastSeq: () => lastSeq,
    done,
  };
}
