import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-10: approval creates a notification; bell badge, page list and
 * single/all read flows work. */
test("notifications: unread badge, page list, mark read", async ({ page }) => {
  await login(page);
  // deterministic baseline: earlier specs may have left unread/read rows
  await page.request.post("/api/v1/notifications/read-all");
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  const box = page.getByLabel("消息输入框");
  await box.fill("请用 fs.write 工具把内容 'notify-e2e' 写入 notify-e2e.txt");
  await box.press("Enter");
  await expect(page.getByTestId("approval-card")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("notification-badge")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("notification-item").first()).toBeVisible();
  await page.getByTestId("notification-open-page").click();
  await page.waitForURL("**/notifications");
  await expect(page.getByRole("heading", { name: "通知", level: 1 })).toBeVisible();
  await expect(page.getByTestId("notification-perm")).toBeVisible();

  const item = page.getByTestId("notification-page-item").first();
  await expect(item).toBeVisible();
  await item.getByTestId("notification-mark-read").click();
  await expect(item.getByTestId("notification-mark-read")).toHaveCount(0, {
    timeout: 15_000,
  });

  await page.getByTestId("notifications-unread-filter").click();
  await expect(page.getByText("没有未读通知")).toBeVisible();
  await page.getByRole("button", { name: "查看全部通知" }).click();
  await expect(page.getByTestId("notification-page-item").first()).toBeVisible();

  // "待我决定" is the shared inbox entry from both the page and the bell
  await expect(page.getByTestId("notifications-inbox")).toContainText("待我决定");
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("bell-inbox")).toContainText("待我决定");
  await page.getByTestId("bell-inbox").click();
  await page.waitForURL("**/tasks?bucket=attention");
  await expect(page.getByTestId("bucket-attention")).toHaveAttribute(
    "aria-selected", "true",
  );
});
