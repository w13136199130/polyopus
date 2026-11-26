import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("routes: tab/filter state is shareable via URL", async ({ page }) => {
  await login(page);

  await page.goto("/automation");
  await page.getByRole("tab", { name: /已启用/ }).click();
  await expect(page).toHaveURL(/filter=on/);

  await page.goto("/notifications");
  await page.getByTestId("notifications-unread-filter").click();
  await expect(page).toHaveURL(/filter=unread/);

  await page.goto("/connections");
  await page.getByTestId("connector-subtab-builtin").click();
  await expect(page).toHaveURL(/sub=builtin/);

  await page.goto("/extensions?tab=skills");
  await expect(page.getByTestId("ext-tab-skills")).toHaveAttribute("aria-selected", "true");

  await page.goto("/admin?tab=users&sub=roles");
  await expect(page.getByTestId("admin-tab-users")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("admin-subtab-roles")).toHaveAttribute("aria-selected", "true");
});

test("routes: canonical ticket/chat paths and teams alias", async ({ page }) => {
  await login(page);

  // /teams remains a compatibility alias for 专家 → 我的团队
  await page.goto("/teams");
  await page.waitForURL(/\/agents\?tab=team/);
  await expect(page.getByTestId("teams-page")).toBeVisible();

  // /tasks/:ticketId deep link resolves the same inline detail
  const title = `路径深链 ${Date.now()}`;
  const created = await page.request.post("/api/v1/tickets", { data: { title } });
  expect(created.status()).toBe(201);
  const ticketId = (await created.json()).ticketId as string;
  await page.goto(`/tasks/${encodeURIComponent(ticketId)}`);
  await expect(page.getByTestId("ticket-detail")).toContainText(title);

  // /chat/:threadId restores the thread without a query string
  await page.goto("/chat");
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const threadId = new URL(page.url()).searchParams.get("threadId");
  expect(threadId).toBeTruthy();
  await page.goto(`/chat/${encodeURIComponent(threadId!)}`);
  await expect(page.getByLabel("消息输入框")).toBeVisible();
});
