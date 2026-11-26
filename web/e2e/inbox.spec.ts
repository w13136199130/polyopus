import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
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
