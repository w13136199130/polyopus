import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

async function clearPending(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/v1/attentions");
  if (!response.ok()) return;
  const items = (await response.json()).items as Array<{ attentionId: string; status: string }>;
  for (const item of items) {
    if (item.status !== "pending") continue;
    await page.request.post(`/api/v1/attentions/${item.attentionId}/answer`, {
      data: { decision: "deny" },
    });
  }
}

/** 收件箱 is a first-class page: approval pumps into it with type chips. */
test("inbox: approval lands in 收件箱 and opens the ticket detail", async ({ page }) => {
  await login(page);
  const title = `收件箱审批 ${Date.now()}`;
  const created = await page.request.post("/api/v1/tickets", {
    data: {
      title,
      content: "请用 fs.write 工具把内容 'inbox-e2e' 写入 inbox-e2e.txt",
    },
  });
  expect(created.status()).toBe(201);
  const ticketId = (await created.json()).ticketId as string;

  await expect.poll(async () => {
    const response = await page.request.get("/api/v1/attentions");
    if (!response.ok()) return 0;
    const items = (await response.json()).items as Array<{
      ticketId: string | null; status: string;
    }>;
    return items.filter((item) => item.ticketId === ticketId && item.status === "pending").length;
  }, { timeout: 20_000 }).toBeGreaterThan(0);

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "收件箱", level: 1 })).toBeVisible();
  await expect(page.getByTestId("inbox-kind-approval")).toBeVisible();

  const row = page.getByTestId("ticket-row").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByTestId("ticket-detail")).toContainText(title);
  expect(page.url()).toContain("ticketId=");
});


test("inbox: batch approve two same-class approvals", async ({ page }) => {
  await login(page);
  await clearPending(page);
  const stamp = Date.now();
  const created = await Promise.all([
    page.request.post("/api/v1/tickets", {
      data: { title: `批量审批 A ${stamp}`, content: "请用 fs.write 工具把 A 写入 batch-a.txt" },
    }),
    page.request.post("/api/v1/tickets", {
      data: { title: `批量审批 B ${stamp}`, content: "请用 fs.write 工具把 B 写入 batch-b.txt" },
    }),
  ]);
  for (const response of created) expect(response.status()).toBe(201);

  await expect.poll(async () => {
    const response = await page.request.get("/api/v1/attentions");
    if (!response.ok()) return 0;
    const items = (await response.json()).items as Array<{ status: string }>;
    return items.filter((item) => item.status === "pending").length;
  }, { timeout: 25_000 }).toBeGreaterThanOrEqual(2);

  await page.goto("/inbox");
  const checks = page.getByTestId("inbox-select");
  await expect(checks.first()).toBeVisible({ timeout: 15_000 });
  const count = await checks.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  await expect(page.getByTestId("inbox-batch-approve")).toBeVisible();
  await page.getByTestId("inbox-batch-approve").click();
  const confirm = page.getByRole("dialog", { name: "批量批准审批" });
  await expect(confirm).toBeVisible();
  await confirm.getByTestId("inbox-batch-confirm").click();
  await expect(page.getByText(/已批准 [0-9]+ 项审批/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("inbox-select")).toHaveCount(0, { timeout: 20_000 });
});
