/**
 * Tasks data hooks (docs/49 §4.2): tickets list and server bucket counts poll
 * 3s; the drawer polls detail + timeline.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sources, tickets } from "@/lib/api/endpoints";
import type { TicketRow } from "@/lib/api/wire";

export const BUCKETS = ["attention", "running", "queued", "done"] as const;
export type Bucket = (typeof BUCKETS)[number];
export type BucketFilter = Bucket | "all";

export const taskKeys = {
  tickets: ["tickets"] as const,
  counts: ["ticket-counts"] as const,
  ticket: (id: string) => ["ticket", id] as const,
  timeline: (id: string) => ["ticket-timeline", id] as const,
};

export function useTickets() {
  return useQuery({
    queryKey: taskKeys.tickets,
    queryFn: tickets.list,
    refetchInterval: 3_000, // docs/49 §4.2
  });
}

/** Server-side bucket counts (V05-22). */
export function useTicketCounts() {
  return useQuery({
    queryKey: taskKeys.counts,
    queryFn: tickets.counts,
    refetchInterval: 3_000,
  });
}

export function useTicketTimeline(ticketId: string | null) {
  return useQuery({
    queryKey: taskKeys.timeline(ticketId ?? "none"),
    queryFn: () => tickets.timeline(ticketId as string),
    enabled: ticketId !== null,
    refetchInterval: 5_000,
  });
}

/** Detail view while the drawer is open (V05-22 adds timeline + counts API). */
export function useTicketDetail(ticketId: string | null) {
  return useQuery({
    queryKey: taskKeys.ticket(ticketId ?? "none"),
    queryFn: () => tickets.detail(ticketId as string),
    enabled: ticketId !== null,
    refetchInterval: 5_000,
  });
}

export function useStopTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => tickets.stop(ticketId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: taskKeys.tickets });
    },
  });
}

/** Manual ticket (P0-3): POST /tickets with title + optional brief. */
export function useCreateTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; content?: string; priority?: number }) =>
      tickets.create(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: taskKeys.tickets });
      void client.invalidateQueries({ queryKey: taskKeys.counts });
    },
  });
}

export function bucketCounts(rows: TicketRow[] | undefined): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { attention: 0, running: 0, queued: 0, done: 0 };
  for (const row of rows ?? []) {
    if (row.bucket in counts) counts[row.bucket as Bucket] += 1;
  }
  return counts;
}

export function inBucket(rows: TicketRow[] | undefined, bucket: Bucket | "all"): TicketRow[] {
  return bucket === "all" ? (rows ?? []) : (rows ?? []).filter((row) => row.bucket === bucket);
}

/**
 * Empty-state seed: a secret-less demo source + one webhook, mirroring the
 * legacy page's trigger button (docs/48 V05-04: "空态给创建演示 webhook").
 */
export async function seedDemoTicket(): Promise<string> {
  const source = await sources.create({
    name: `demo-${Date.now()}`,
    generateSecret: false,
    allowActors: ["alice"],
    explicitPatterns: ["/polyopus"],
  });
  const accepted = await sources.postWebhook(source.sourceId, {
    external_id: `demo-${Date.now()}`,
    thread_key: "demo",
    actor: { id: "alice", kind: "user" },
    text: "/polyopus 任务中心演示触发",
  });
  return accepted.ticketId ?? "";
}
