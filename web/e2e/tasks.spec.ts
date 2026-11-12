import { expect, test } from "@playwright/test";

/**
 * Task center under AUTO-EXECUTION (V05-07 changed the contract: queued
 * tickets drain by themselves, so counting "queued" is racy by design).
 *
 * Stable assertions instead:
 *  - wait for the worker to idle, seed 2, watch the DONE bucket grow by 2
 *  - detail drawer shows the ready Report (scope/budget/执行 completed)
 *  - stop flow via a ticket paused at the policy gate (deterministic pause):
 *    FakeModel's write intent parks the ticket in 待决 -> stop -> done
 */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

interface TicketRow {
  ticketId: string;
  bucket: string;
  state: string;
}

async function listTickets(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/v1/tickets");
  expect(response.ok()).toBe(true);
  return (await response.json()).items as TicketRow[];
}

/** Wait until the embedded ticket worker has drained the queue. */
async function waitIdle(page: import("@playwright/test").Page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const rows = await listTickets(page);
    const busy = rows.filter((row) => row.bucket === "queued" || row.bucket === "running");
    if (busy.length === 0) return rows;
    await page.waitForTimeout(300);
  }
  throw new Error("ticket worker did not drain the queue in time");
}

async function seedTickets(
  page: import("@playwright/test").Page,
  texts: string[],
) {
  const created = await page.request.post("/api/v1/sources", {
    data: {
      name: `tasks-e2e-${Date.now()}`,
      generateSecret: false,
      allowActors: ["alice"],
      explicitPatterns: ["/polyopus"],
    },
  });
  expect(created.ok()).toBe(true);
  const source = await created.json();

  const ids: string[] = [];
  for (const text of texts) {
    const response = await page.request.post(
      `/api/v1/webhooks/${source.sourceId}`,
      {
        data: {
          externalId: `tasks-e2e-${Date.now()}-${Math.random().toFixed(9)}`,
          threadKey: "tasks-e2e",
          actor: { id: "alice", kind: "user" },
          text,
        },
      },
    );
    expect(response.status()).toBe(202);
    ids.push((await response.json()).ticketId);
  }
  return ids;
}

test("tasks: auto-execution fills the done bucket, drawer shows the report", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tasks");

  const idle = await waitIdle(page);
  const beforeDone = idle.filter((row) => row.bucket === "done").length;

  await seedTickets(page, [
    "/polyopus 自动执行用例一",
    "/polyopus 自动执行用例二",
  ]);

  // V05-07 proof through the UI: both land in done without any manual call
  await expect(page.getByTestId("bucket-done")).toContainText(
    String(beforeDone + 2),
    { timeout: 30_000 },
  );

  // drawer: report ready + scope, ticketId lands in the URL
  await page.getByTestId("ticket-row").first().click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("workspace:default");
  await expect(drawer).toContainText("completed");
  expect(page.url()).toMatch(/ticketId=/);
  await page.keyboard.press("Escape");
});

test("tasks: policy-gated ticket parks in 待决, stop moves it to done", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tasks");

  const idle = await waitIdle(page);
  const beforeDone = idle.filter((row) => row.bucket === "done").length;
  const beforeAttention = idle.filter((row) => row.bucket === "attention").length;

  // write intent -> FakeModel calls fs.write -> policy gate pauses the turn
  // -> report state waiting -> ticket parks in the attention bucket
  const [ticket] = await seedTickets(page, [
    "/polyopus 请用 fs.write 工具把内容 'stop-me' 写入 stop-me.txt",
  ]);

  await expect(page.getByTestId("bucket-attention")).toContainText(
    String(beforeAttention + 1),
    { timeout: 30_000 },
  );

  // the inbox carries the matching approval card
  await expect(page.getByTestId("approval-card").first()).toBeVisible({
    timeout: 15_000,
  });

  // stop via the drawer's confirm dialog -> done +1, attention back
  await page.getByTestId("bucket-attention").click();
  await page.getByTestId("ticket-row").first().click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toContainText(ticket!);
  await drawer.getByRole("button", { name: "停止任务" }).click();
  // the confirm Dialog portals to <body>, outside the drawer's DOM
  const confirm = page.getByRole("dialog", { name: "确认停止" });
  await confirm.getByRole("button", { name: "确认停止" }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  await expect(page.getByTestId("bucket-attention")).toContainText(
    String(beforeAttention),
    { timeout: 15_000 },
  );
  const after = await listTickets(page);
  expect(after.find((row) => row.ticketId === ticket)?.bucket).toBe("done");
  expect(after.filter((row) => row.bucket === "done").length).toBe(beforeDone + 1);
});
