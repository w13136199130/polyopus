import { expect, test } from "@playwright/test";

/**
 * Task center under AUTO-EXECUTION (V05-07 changed the contract: queued
 * tickets drain by themselves, so counting "queued" is racy by design).
 *
 * Stable assertions instead:
 *  - wait for the worker to idle, seed 2, watch the DONE bucket grow by 2
 *  - inline detail shows the ready Report (scope/budget/执行 completed)
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

/** Resolve leftovers from earlier serial tests before counting attention. */
async function clearPendingAttentions(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/v1/attentions");
  if (!response.ok()) return;
  const items = (await response.json()).items as Array<{
    attentionId: string; status: string;
  }>;
  for (const item of items) {
    if (item.status !== "pending") continue;
    await page.request.post(
      `/api/v1/attentions/${item.attentionId}/answer`,
      { data: { decision: "deny" } },
    );
  }
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
      // V05-16: ticket turns now carry their ticket, so the scope gate runs;
      // the write-intent fixture needs fs:write in the mandate scope.
      defaultScope: ["workspace:default", "fs:write"],
    },
  });
  expect(created.ok()).toBe(true);
  const source = await created.json();

  const ids: string[] = [];
  for (const text of texts) {
    // unique thread per ticket: same-thread follow-ups fan out to the open
    // ticket instead of opening new ones (V05-10)
    const nonce = `${Date.now()}-${Math.random().toFixed(9)}`;
    const response = await page.request.post(
      `/api/v1/webhooks/${source.sourceId}`,
      {
        data: {
          externalId: `tasks-e2e-${nonce}`,
          threadKey: `tasks-e2e-${nonce}`,
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

test("tasks: auto-execution fills the done bucket, detail shows the report", async ({
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

  // inline detail: report ready + scope, ticketId lands in the URL
  await page.getByTestId("ticket-row").first().click();
  const detail = page.getByTestId("ticket-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("workspace:default");
  await expect(detail).toContainText("completed");
  await expect(detail).toContainText("Gate");
  await expect(detail).toContainText("Eval");
  expect(page.url()).toMatch(/ticketId=/);
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

  // the card carries the matching approval actions inline
  await page.getByTestId("bucket-attention").click();
  const card = page.locator(
    `[data-testid="ticket-row"][data-ticket-id="${ticket}"]`,
  );
  await expect(card.getByTestId("card-approve")).toBeVisible({ timeout: 15_000 });

  // stop via the inline detail's confirm dialog -> done +1, attention back
  await card.click();
  const detail = page.getByTestId("ticket-detail");
  await expect(detail).toContainText(ticket!);
  await expect(detail.getByTestId("budget-bar")).toBeVisible();
  await page.getByTestId("drawer-stop").click();
  const confirm = page.getByRole("dialog", { name: "取消任务" });
  await confirm.getByRole("button", { name: "确认取消" }).click();

  await expect(page.getByTestId("bucket-attention")).toContainText(
    String(beforeAttention),
    { timeout: 15_000 },
  );
  const after = await listTickets(page);
  expect(after.find((row) => row.ticketId === ticket)?.bucket).toBe("done");
  expect(after.filter((row) => row.bucket === "done").length).toBe(beforeDone + 1);
});

/** P0-3: manual ticket — 新建任务 dialog creates a queued ticket that the
 * worker then drives to done, and the inline detail opens on it. */
test("tasks: manual create from the 新建任务 dialog", async ({ page }) => {
  await login(page);
  await page.goto("/tasks");

  const idle = await waitIdle(page);
  const beforeDone = idle.filter((row) => row.bucket === "done").length;

  const title = `手动任务 ${Date.now()}`;
  await page.getByTestId("new-ticket").click();
  const dialog = page.getByRole("dialog", { name: "新建任务" });
  await dialog.getByTestId("new-ticket-title").fill(title);
  await dialog
    .getByTestId("new-ticket-brief")
    .fill("请把工作日志整理成三行总结，输出到回复里。");
  await dialog.getByTestId("new-ticket-submit").click();

  // creation selects the new ticket in the inline detail
  const detail = page.getByTestId("ticket-detail");
  await expect(detail).toContainText(title, { timeout: 15_000 });

  // and the worker drains it to done like any source ticket
  await expect(page.getByTestId("bucket-done")).toContainText(
    String(beforeDone + 1),
    { timeout: 30_000 },
  );
});

/** Prototype restore: attention cards answer inline (允许/拒绝) without
 * leaving the list; bucket tab shows the red pending count. */
test("tasks: inline approval on the attention card", async ({ page }) => {
  await login(page);
  await page.goto("/tasks");
  await clearPendingAttentions(page);
  await waitIdle(page);

  const beforeAttention = (await listTickets(page))
    .filter((row) => row.bucket === "attention").length;
  const [ticket] = await seedTickets(page, [
    "/polyopus 请用 fs.write 工具把内容 'inline-e2e' 写入 inline-e2e.txt",
  ]);
  await expect(page.getByTestId("bucket-attention")).toContainText(
    String(beforeAttention + 1),
    { timeout: 30_000 },
  );

  await page.getByTestId("bucket-attention").click();
  const card = page.locator(
    `[data-testid="ticket-row"][data-ticket-id="${ticket}"]`,
  );
  await expect(card).toBeVisible({ timeout: 15_000 });
  const deny = card.getByTestId("card-deny");
  await expect(deny).toBeVisible({ timeout: 15_000 });

  // deny in place: the approval resolves without leaving the list; the
  // engine refuses the write, finishes its final round, and the ticket
  // completes out of the attention bucket.
  await deny.click();
  await expect(deny).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => {
    const rows = await listTickets(page);
    return rows.find((row) => row.ticketId === ticket)?.bucket;
  }, { timeout: 30_000 }).toBe("done");
  const after = await listTickets(page);
  expect(after.filter((row) => row.bucket === "attention").length)
    .toBe(beforeAttention);
});

/** Prototype task detail: 追加预算 raises the ceiling without touching the
 * mandate and writes an auditable timeline row. */
test("tasks: add budget from inline detail", async ({ page }) => {
  await login(page);
  await page.goto("/tasks");
  await waitIdle(page);

  const [ticket] = await seedTickets(page, [
    "/polyopus 请用 fs.write 工具把内容 'budget-e2e' 写入 budget-e2e.txt",
  ]);
  await expect(page.getByTestId("bucket-attention")).toContainText("1", {
    timeout: 30_000,
  });
  await page.getByTestId("bucket-attention").click();
  const card = page.locator(
    `[data-testid="ticket-row"][data-ticket-id="${ticket}"]`,
  );
  await card.click();
  const detail = page.getByTestId("ticket-detail");
  await expect(detail).toContainText(ticket!);

  await detail.getByTestId("detail-budget").click();
  const dialog = page.getByRole("dialog", { name: "追加预算" });
  await dialog.getByTestId("budget-amount").fill("2");
  await dialog.getByTestId("budget-submit").click();
  await expect(detail).toContainText("已追加预算 ¥2.00", { timeout: 15_000 });
  await expect(detail).toContainText("¥2.00", { timeout: 15_000 });
  await expect(detail).toContainText("追加预算");
});

test("tasks: executed write registers an artifact and previews it", async ({ page }) => {
  await login(page);
  const source = await page.request.post("/api/v1/sources", {
    data: {
      name: `artifact-e2e-${Date.now()}`,
      generateSecret: false,
      allowActors: ["alice"],
      explicitPatterns: ["/polyopus"],
      defaultScope: ["workspace:default", "fs:write"],
      autoApproveTools: ["fs.write"],
      autoApproveMaxRisk: "high",
    },
  });
  expect(source.ok()).toBe(true);
  const sourceId = (await source.json()).sourceId;
  const nonce = `${Date.now()}-${Math.random().toFixed(9)}`;
  const event = await page.request.post(`/api/v1/webhooks/${sourceId}`, {
    data: {
      externalId: `artifact-e2e-${nonce}`,
      threadKey: `artifact-e2e-${nonce}`,
      actor: { id: "alice", kind: "user" },
      text: "/polyopus 请用 fs.write 工具把内容 'artifact-e2e-ok' 写入 artifact-e2e.txt",
    },
  });
  expect(event.status()).toBe(202);
  const ticketId = (await event.json()).ticketId;
  await waitIdle(page);

  await page.goto(`/tasks?ticketId=${encodeURIComponent(ticketId)}`);
  const detail = page.getByTestId("ticket-detail");
  await expect(detail).toContainText("artifact-e2e.txt", { timeout: 20_000 });
  await detail.getByTestId("artifact-preview").click();
  await expect(page.getByRole("dialog", { name: /产物 · artifact-e2e.txt/ }))
    .toContainText("artifact-e2e-ok");
});

test("tasks: rerun then delete a completed ticket", async ({ page }) => {
  await login(page);
  const [ticketId] = await seedTickets(page, ["/polyopus 重跑与删除用例"]);
  await waitIdle(page);

  await page.goto(`/tasks?ticketId=${encodeURIComponent(ticketId!)}`);
  const detail = page.getByTestId("ticket-detail");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await detail.getByTestId("detail-rerun").click();
  await expect(page.getByText("已重新排队")).toBeVisible({ timeout: 10_000 });
  await waitIdle(page);

  const reopened = page.getByTestId("ticket-detail");
  await reopened.getByTestId("detail-delete").click();
  await page.getByRole("dialog", { name: "删除任务" })
    .getByTestId("confirm-delete").click();
  await expect(page.locator(
    `[data-testid="ticket-row"][data-ticket-id="${ticketId}"]`,
  )).toHaveCount(0);
  expect(page.url()).not.toContain("ticketId=");
});

test("tasks: manual write parks approval in detail then produces artifact", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/v1/tickets", {
    data: {
      title: "手动写文件",
      content: "请用 fs.write 工具把内容 'manual-artifact-ok' 写入 manual-artifact.txt",
    },
  });
  expect(created.status()).toBe(201);
  const ticketId = (await created.json()).ticketId as string;

  await page.goto(`/tasks?ticketId=${encodeURIComponent(ticketId)}`);
  const detail = page.getByTestId("ticket-detail");
  const approval = detail.getByTestId("approval-card");
  await expect(approval).toBeVisible({ timeout: 20_000 });
  await approval.getByRole("button", { name: "仅本次允许" }).click();
  await expect(approval).toBeHidden({ timeout: 20_000 });
  await waitIdle(page);

  await expect(detail).toContainText("manual-artifact.txt", { timeout: 20_000 });
  await detail.getByTestId("artifact-preview").click();
  await expect(page.getByRole("dialog", { name: /产物 · manual-artifact.txt/ }))
    .toContainText("manual-artifact-ok");
});

test("tasks: detail shows instruction and edits stopped ticket", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/v1/tickets", {
    data: { title: "说明测试", content: "原始任务说明：整理日志。" },
  });
  const ticketId = (await created.json()).ticketId as string;
  await waitIdle(page);

  await page.goto(`/tasks?ticketId=${encodeURIComponent(ticketId)}`);
  const detail = page.getByTestId("ticket-detail");
  await expect(detail.getByTestId("task-instruction")).toContainText("原始任务说明：整理日志。");

  await detail.getByTestId("detail-edit").click();
  const dialog = page.getByRole("dialog", { name: "编辑任务" });
  await dialog.getByTestId("ticket-edit-title").fill("说明测试（已编辑）");
  await dialog.getByTestId("ticket-edit-instruction")
    .fill("新任务说明：分析天气并写入 weather.md。");
  await dialog.getByTestId("ticket-edit-save").click();
  await expect(page.getByText("任务已更新；再次运行会使用新说明。")).toBeVisible();
  await expect(page.getByTestId("ticket-detail")).toContainText("新任务说明：分析天气并写入 weather.md。");
});
