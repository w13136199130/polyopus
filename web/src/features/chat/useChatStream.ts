/**
 * useChatStream: one transport + store per chat page mount. Connects to the
 * thread's event stream, feeds the store, invalidates Query caches on
 * terminal events (docs/49 §4.3), reconnects after a mid-turn drop and on
 * each new send after a previous turn closed the stream.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSseTransport } from "@/lib/stream/sseTransport";
import type { StreamTransport } from "@/lib/stream/transport";
import { bindTransport, ChatStreamStore } from "./streamStore";
import { chatKeys } from "./api";

const ACK_TIMEOUT_MS = 2_000; // docs/49 §4.4: withdraw + restore on no-ack

export interface UseChatStream {
  store: ChatStreamStore;
  transport: StreamTransport;
  /**
   * Send with optimistic bubble + 2s ack rollback. Returns false when the
   * optimistic message was withdrawn (caller restores the composer text).
   */
  send: (content: string) => Promise<boolean>;
}

export function useChatStream(
  threadId: string | null,
  onRollback: (content: string) => void = () => undefined,
): UseChatStream {
  const client = useQueryClient();
  const store = useMemo(() => new ChatStreamStore(), []);
  const transport = useMemo(() => createSseTransport(), []);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollbackRef = useRef(onRollback);
  rollbackRef.current = onRollback;
  // wiring below is mounted once; read the CURRENT thread through a ref so
  // invalidations don't live in a stale closure from the first render
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  // ---- transport wiring (once) ---------------------------------------------
  useEffect(() => {
    const off = bindTransport(transport, store);
    const offGap = transport.onGap(() => {
      // seq hole: rebuild from the projection instead of guessing
      const id = threadIdRef.current;
      if (id) void client.invalidateQueries({ queryKey: chatKeys.messages(id) });
    });
    // a mid-turn drop closes the stream; reopen from the last seq while a
    // turn is still in flight (docs/49 §4.5 watchdog, simplified for v0.5)
    const offState = transport.onState((state) => {
      const status = store.getSnapshot().status;
      const active =
        status === "optimistic" || status === "streaming" || status === "waiting_approval";
      if (state === "closed" && active && threadIdRef.current) {
        transport.connect({
          threadId: threadIdRef.current,
          afterSeq: store.getSnapshot().lastEventSeq,
          signal: new AbortController().signal,
        });
      }
      if (state === "unauthorized" || state === "error") store.setConnection(state);
    });
    // terminal events invalidate the projections
    const offFrame = transport.onFrame((frame) => {
      if (frame.type === "turn.finished" || frame.type === "message.completed") {
        const id = threadIdRef.current;
        if (id) void client.invalidateQueries({ queryKey: chatKeys.messages(id) });
        void client.invalidateQueries({ queryKey: chatKeys.threads });
      }
      if (frame.type === "approval.requested" || frame.type === "approval.resolved") {
        void client.invalidateQueries({ queryKey: chatKeys.attentions });
      }
    });
    return () => {
      off();
      offGap();
      offState();
      offFrame();
      transport.close();
      store.flush();
    };
  }, [client, store, transport]);

  // ---- (re)connect when the thread changes ---------------------------------
  useEffect(() => {
    if (!threadId) return;
    transport.close();
    store.resetToIdle();
    transport.connect({
      threadId,
      afterSeq: 0, // replay is cheap; store ignores foreign turns
      signal: new AbortController().signal,
    });
    return () => transport.close();
  }, [threadId, store, transport]);

  // ---- send with optimistic rollback ---------------------------------------
  const send = async (content: string): Promise<boolean> => {
    if (!threadId) return false;
    const pendingId = `pending-${Date.now()}`;
    store.beginOptimistic(pendingId, content);

    ackTimer.current = setTimeout(() => {
      // no ack in 2s: withdraw the bubble, hand the text back to the composer
      const restored = store.rollback();
      if (restored) rollbackRef.current(restored);
    }, ACK_TIMEOUT_MS);

    try {
      const { threads } = await import("@/lib/api/endpoints");
      const result = await threads.postTurn(threadId, content, pendingId);
      if (ackTimer.current) clearTimeout(ackTimer.current);
      // (re)open the stream for this turn if it closed after a previous one
      transport.connect({
        threadId,
        afterSeq: store.getSnapshot().lastEventSeq,
        signal: new AbortController().signal,
      });
      store.ack(result.turnId);
      return true;
    } catch {
      if (ackTimer.current) clearTimeout(ackTimer.current);
      const restored = store.rollback();
      if (restored) rollbackRef.current(restored);
      return false;
    }
  };

  return { store, transport, send };
}
