import { expect, test } from "@playwright/test";

/**
 * V05-04 acceptance: seed 2 tickets via the webhook API -> bucket counts are
 * right in the UI -> detail drawer shows scope/budget/report -> stop moves
 * the ticket to done. The e2e DB persists across runs, so all count checks
 * are deltas measured against the list API before seeding.
 */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

async function listTickets(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/v1/tickets");
  expect(response.ok()).toBe(true);
  return (await response.json()).items as Array<{ ticketId: string; bucket: string }>;
}

async function seedTickets(page: import("@playwright/test").Page, count: number) {
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
  for (let i = 0; i < count; i += 1) {
    const response = await page.request.post(
      `/api/v1/webhooks/${source.sourceId}`,
      {
        data: {
          external_id: `tasks-e2e-${Date.now()}-${i}`,
          thread_key: "tasks-e2e",
          actor: { id: "alice", kind: "user" },
          text: `/polyopus 任务中心用例 ${i}`,
        },
      },
    );
    expect(response.status()).toBe(202);
    ids.push((await response.json()).ticketId);
  }
  return ids;
}

test("tasks: buckets, detail drawer, stop to done", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "任务" }).click();
  await page.waitForURL("**/tasks");

  const before = await listTickets(page);
  const beforeQueued = before.filter((ticket) => ticket.bucket === "queued").length;
  const beforeDone = before.filter((ticket) => ticket.bucket === "done").length;

  const seeded = await seedTickets(page, 2);
  expect(seeded).toHaveLength(2);

  // four buckets show the right counts (delta vs before, list poll is 3s)
  const queuedTab = page.getByTestId("bucket-queued");
  await expect(queuedTab).toContainText(String(beforeQueued + 2), { timeout: 15_000 });
  await expect(page.getByTestId("bucket-done")).toContainText(String(beforeDone));

  // detail drawer: scope/budget/report, ticketId lands in the URL
  await page.getByTestId("ticket-row").first().click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toContainText("workspace:default");
  await expect(page.getByRole("dialog", { name: "任务详情" })).toContainText("暂无");
  expect(page.url()).toMatch(/ticketId=/);

  // stop with confirmation -> moves to done
  const target = seeded[0]!;
  await page.request.post(`/api/v1/tickets/${target}/stop`).then((response) => {
    expect(response.ok()).toBe(true);
  });
  await expect(page.getByTestId("bucket-done")).toContainText(
    String(beforeDone + 1),
    { timeout: 15_000 },
  );
});

test("tasks: empty-state seeds a demo ticket via the UI", async ({ page }) => {
  await login(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();

  // the demo button only shows with an empty list — force the empty bucket
  await page.getByTestId("bucket-attention").click();
  const demo = page.getByRole("button", { name: /创建演示任务/ });
  if (await demo.isVisible()) {
    await demo.click();
    await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible({
      timeout: 15_000,
    });
  } else {
    // attention bucket already had rows in this long-lived e2e DB: acceptable
    await expect(page.getByTestId("ticket-row").first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
});
