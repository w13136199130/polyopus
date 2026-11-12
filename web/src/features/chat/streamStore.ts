/**
 * Chat stream store (docs/49 §4.3): the single home for the ACTIVE turn's
 * streamed text. Server snapshots live in TanStack Query; once a turn
 * finishes, this store clears and the messages projection takes over.
 *
 * Paint rules: text deltas coalesce on a 50ms timer; status changes
 * (approval requested, finished, connection state) notify immediately.
 */

import type { EventFrame, StreamTransport, TransportState } from "@/lib/stream/transport";

export type TurnStatus =
  | "idle" // nothing running
  | "optimistic" // sent, waiting for server ack
  | "streaming" // deltas arriving
  | "waiting_approval" // paused at the policy gate
  | "finished"; // turn.finished seen; messages query supersedes us

export interface ChatStreamSnapshot {
  turnId: string | null;
  status: TurnStatus;
  /** Assistant text accumulated for the active turn (may be ""). */
  text: string;
  /** Connection health, surfaced by StreamConnectingIndicator. */
  connection: TransportState;
  /** Optimistic user message not yet confirmed by the server. */
  pendingUser: { id: string; content: string } | null;
  lastEventSeq: number;
}

const PAINT_MS = 50;

export class ChatStreamStore {
  private listeners = new Set<() => void>();
  private snapshot: ChatStreamSnapshot = {
    turnId: null,
    status: "idle",
    text: "",
    connection: "closed",
    pendingUser: null,
    lastEventSeq: 0,
  };
  private paintTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyText = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChatStreamSnapshot => this.snapshot;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Immediate notify (status/structure changes). */
  private commit(patch: Partial<ChatStreamSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify();
  }

  /** Coalesced notify for high-frequency text deltas. */
  private commitText(text: string): void {
    this.snapshot = { ...this.snapshot, text };
    this.dirtyText = true;
    if (this.paintTimer) return;
    this.paintTimer = setTimeout(() => {
      this.paintTimer = null;
      this.dirtyText = false;
      this.notify();
    }, PAINT_MS);
  }

  /** Flush any pending paint immediately (turn end, unmount). */
  flush(): void {
    if (this.paintTimer) {
      clearTimeout(this.paintTimer);
      this.paintTimer = null;
    }
    if (this.dirtyText) {
      this.dirtyText = false;
      this.notify();
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Optimistic send: remember the bubble; status waits for the ack. */
  beginOptimistic(pendingId: string, content: string): void {
    this.commit({
      turnId: null,
      status: "optimistic",
      text: "",
      pendingUser: { id: pendingId, content },
      lastEventSeq: 0,
    });
  }

  /** Server ack (turn.queued with our turnId). */
  ack(turnId: string): void {
    this.commit({ turnId, status: this.snapshot.status === "optimistic"
      ? "streaming" : this.snapshot.status, pendingUser: null });
  }

  /** Withdraw the optimistic bubble and restore the composer input. */
  rollback(): string | null {
    const content = this.snapshot.pendingUser?.content ?? null;
    this.commit({ turnId: null, status: "idle", text: "", pendingUser: null });
    return content;
  }

  setConnection(connection: TransportState): void {
    if (connection !== this.snapshot.connection) this.commit({ connection });
  }

  // ---- event ingestion (transport frames) ----------------------------------

  ingest(frame: EventFrame): void {
    const snapshot = this.snapshot;
    if (snapshot.status === "idle" || snapshot.status === "finished") return;
    // frames from other turns (replayed history) are not ours to paint
    if (snapshot.turnId && frame.turnId && frame.turnId !== snapshot.turnId) {
      this.trackSeq(frame.seq);
      return;
    }

    switch (frame.type) {
      case "message.delta": {
        const text = String((frame.payload as { text?: string })?.text ?? "");
        if (text) this.commitText(this.snapshot.text + text);
        break;
      }
      case "message.completed": {
        // blocks are authoritative: overwrite the accumulated deltas
        const blocks = (frame.payload as { blocks?: Array<{ type?: string; text?: string }> })
          ?.blocks;
        const text = (blocks ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n");
        this.commitText(text);
        break;
      }
      case "approval.requested":
        this.commit({ status: "waiting_approval" });
        break;
      case "approval.resolved":
      case "turn.resumed":
        this.commit({ status: "streaming" });
        break;
      case "turn.finished":
        this.flush();
        this.commit({ status: "finished", text: "" });
        break;
      default:
        break;
    }
    this.trackSeq(frame.seq);
  }

  private trackSeq(seq: number): void {
    if (seq > this.snapshot.lastEventSeq) {
      this.snapshot = { ...this.snapshot, lastEventSeq: seq };
    }
  }

  /** After finished: drop the turn so the next send starts clean. */
  resetToIdle(): void {
    this.flush();
    this.commit({ turnId: null, status: "idle", text: "", pendingUser: null });
  }
}

/** Wire a transport into a store; returns cleanup. Frames for other turns are skipped. */
export function bindTransport(
  transport: StreamTransport,
  store: ChatStreamStore,
): () => void {
  const offFrame = transport.onFrame((frame) => store.ingest(frame));
  const offState = transport.onState((state) => store.setConnection(state));
  return () => {
    offFrame();
    offState();
  };
}
