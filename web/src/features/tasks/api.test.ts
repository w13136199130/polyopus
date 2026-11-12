import { describe, expect, it } from "vitest";
import type { TicketRow } from "@/lib/api/wire";
import { bucketCounts, inBucket, type Bucket } from "./api";

function row(bucket: string, id = bucket): TicketRow {
  return {
    ticketId: `tk_${id}`,
    title: "t",
    state: "open",
    bucket,
    strength: "explicit",
    sourceId: null,
    createdAt: 0,
  };
}

describe("bucketCounts", () => {
  it("aggregates the four buckets from the list (V05-22 will move this server-side)", () => {
    const counts = bucketCounts([
      row("queued", "1"),
      row("queued", "2"),
      row("running"),
      row("done"),
      row("attention"),
    ]);
    expect(counts).toEqual({ attention: 1, running: 1, queued: 2, done: 1 });
  });

  it("unknown buckets are ignored, not crashed on", () => {
    expect(bucketCounts([row("weird-future-bucket")])).toEqual({
      attention: 0,
      running: 0,
      queued: 0,
      done: 0,
    });
  });

  it("undefined list is all zeros", () => {
    expect(bucketCounts(undefined)).toEqual({
      attention: 0,
      running: 0,
      queued: 0,
      done: 0,
    });
  });
});

describe("inBucket", () => {
  const rows = [row("queued", "1"), row("done", "2")];

  it("filters to one bucket", () => {
    expect(inBucket(rows, "queued" as Bucket).map((r) => r.ticketId)).toEqual(["tk_1"]);
  });

  it("all returns everything", () => {
    expect(inBucket(rows, "all")).toHaveLength(2);
  });

  it("undefined rows -> empty", () => {
    expect(inBucket(undefined, "all")).toEqual([]);
  });
});
