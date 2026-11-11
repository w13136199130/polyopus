/**
 * Transport seam (docs/49 §5.6): the stream store depends on this narrow
 * interface, never on SSE specifics. v0.5 ships the SSE implementation; a
 * future WS transport swaps in without touching store or pages.
 */

export interface EventFrame {
  seq: number;
  type: string;
  ts: number;
  turnId?: string;
  payload?: Record<string, unknown>;
}

export type TransportState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error"
  | "unauthorized";

export interface StreamTransport {
  connect(input: { threadId: string; afterSeq: number; signal: AbortSignal }): void;
  close(): void;
  /** Frames after `afterSeq`, deduped, in seq order. */
  onFrame(cb: (frame: EventFrame) => void): () => void;
  onState(cb: (state: TransportState) => void): () => void;
  /** Observed gap (missing seqs) — caller decides to snapshot or ignore. */
  onGap(cb: (from: number, to: number) => void): () => void;
  lastSeq(): number;
}
