import { expect, test } from "@playwright/test";

/**
 * V05-20: SourcesTab CRUD + the acceptance loop —
 * create webhook -> send test event -> task appears -> stop -> done.
 */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("sources: create webhook -> test event -> task -> stop", async ({ page }) => {
  await login(page);
  await page.goto("/sources");

  const name = `e2e-hook-${Date.now()}`;
  await page.getByTestId("source-name-input").fill(name);
  await page.getByTestId("source-actor-input").fill("alice");
  await page.getByTestId("source-pattern-input").fill("/polyopus");
  await page.getByTestId("source-create-submit").click();

  const row = page.getByTestId("source-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("source-secret-once")).toHaveCount(0);

  await row.getByTestId("source-test-webhook").click();
  await expect(page.getByText(/已触发任务|已发送 webhook/)).toBeVisible();

  await page.goto("/tasks");
  await page.getByTestId("task-source").filter({ hasText: name }).click();

  const ticket = page.getByTestId("ticket-row").first();
  await expect(ticket).toBeVisible({ timeout: 15_000 });
  await ticket.click();

  await expect(page.getByTestId("ticket-detail")).toBeVisible();
  // The test event carries write intent and the source scope allows fs:write,
  // so the ticket parks at the policy gate -- deterministic stop target.
  await page.getByTestId("drawer-stop").click();
  await page.getByRole("button", { name: "确认取消" }).click();

  await page.getByTestId("bucket-done").click();
  await expect(page.getByTestId("ticket-row").filter({ hasText: "保存结果" })).toBeVisible({
    timeout: 15_000,
  });
});

test("sources: schedule create then delete", async ({ page }) => {
  await login(page);
  await page.goto("/sources");

  const name = `e2e-cron-${Date.now()}`;
  await page.getByTestId("schedule-name-input").fill(name);
  await page.getByTestId("schedule-spec-input").fill("interval:3600");
  await page.getByTestId("schedule-timezone-input").fill("UTC");
  await page.getByTestId("schedule-text-input").fill("/polyopus 定时巡检");
  await page.getByTestId("schedule-create-submit").click();

  const row = page.getByTestId("cron-row").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByTestId("cron-toggle").click();
  await expect(row).toContainText("paused");

  await row.getByTestId("cron-delete").click();
  await page.getByTestId("confirm-delete").click();
  await expect(row).toHaveCount(0);
});

test("sources: generated secret is shown once", async ({ page }) => {
  await login(page);
  await page.goto("/sources");

  const name = `e2e-secret-${Date.now()}`;
  await page.getByTestId("source-name-input").fill(name);
  await page.getByTestId("source-secret-checkbox").check();
  await page.getByTestId("source-create-submit").click();

  const secret = page.getByTestId("source-secret-once");
  await expect(secret).toBeVisible();
  await expect(secret.locator("code")).not.toBeEmpty();
  await secret.getByRole("button", { name: "我已保存" }).click();
  await expect(secret).toHaveCount(0);

  const row = page.getByTestId("source-row").filter({ hasText: name });
  await row.getByTestId("source-delete").click();
  await page.getByTestId("confirm-delete").click();
  await expect(row).toHaveCount(0);
});
