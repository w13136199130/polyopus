/**
 * SSE implementation of StreamTransport (docs/49 §5.6). The only transport
 * in v0.5; a WS transport in v1.0+ implements the same interface.
 */

import { connectEvents } from "./sse";
import type { EventFrame, StreamTransport, TransportState } from "./transport";

type Cb<T> = (value: T) => void;

export function createSseTransport(): StreamTransport {
  const frameCbs = new Set<Cb<EventFrame>>();
  const stateCbs = new Set<Cb<TransportState>>();
  const gapCbs = new Set<(from: number, to: number) => void>();
  let connection: ReturnType<typeof connectEvents> | null = null;

  return {
    connect({ threadId, afterSeq, signal }) {
      this.close();
      connection = connectEvents({
        threadId,
        afterSeq,
        signal,
        onEvent: (event) => {
          for (const cb of frameCbs) cb(event);
        },
        onGap: (from, to) => {
          for (const cb of gapCbs) cb(from, to);
        },
        onState: (state) => {
          for (const cb of stateCbs) cb(state);
        },
      });
    },
    close() {
      connection?.close();
      connection = null;
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onState(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onGap(cb) {
      gapCbs.add(cb);
      return () => gapCbs.delete(cb);
    },
    lastSeq() {
      return connection?.lastSeq() ?? 0;
    },
  };
}
