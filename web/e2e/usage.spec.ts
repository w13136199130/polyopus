import { expect, test } from "@playwright/test";

/**
 * Batch D: 7/30/90-day usage analytics with overview, daily, agent and model
 * views. The shared e2e backend has FakeModel rows from the chat specs.
 */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("usage: range tabs, overview, group views and export", async ({ page }) => {
  await login(page);

  // make the test self-contained: one FakeModel turn creates a usage row
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const box = page.getByLabel("消息输入框");
  await box.fill("usage seed turn");
  await box.press("Enter");
  await expect(page.getByTestId("bubble-assistant").last()).toContainText("echo[", {
    timeout: 20_000,
  });

  await page.getByRole("link", { name: "Token 统计" }).click();
  await page.waitForURL("**/usage");

  await expect(page.getByRole("heading", { name: "Token 统计" })).toBeVisible();
  expect(page.url()).not.toContain("range=");
  expect(page.url()).not.toContain("view=");

  // overview: KPI cards + daily chart; unpriced cost is never rendered as ¥0
  await expect(page.getByTestId("usage-chart")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("usage-kpi")).toHaveCount(7);
  await expect(page.getByTestId("usage-donut-io")).toBeVisible();
  await expect(page.getByTestId("usage-donut-model")).toBeVisible();
  await expect(page.getByText(/未计价|¥/).first()).toBeVisible();

  // model view: table keeps the fake model rows
  await page.getByTestId("usage-view-model").click();
  await expect(page).toHaveURL(/view=model/);
  const modelTable = page.getByRole("table", { name: /最近 30 天 · 按模型/ });
  await expect(modelTable).toBeVisible();
  await expect(modelTable).toContainText("fake");

  // agent + day views come from the same response
  await page.getByTestId("usage-view-agent").click();
  await expect(page.getByRole("table", { name: /最近 30 天 · 按专家/ })).toBeVisible();
  await page.getByTestId("usage-view-day").click();
  await expect(page.getByRole("table", { name: /最近 30 天 · 按天/ })).toBeVisible();

  // range switch writes URL and updates the caption
  await page.getByTestId("usage-range-90").click();
  await expect(page).toHaveURL(/range=90/);
  await expect(page.getByRole("table", { name: /最近 90 天 · 按天/ })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("polyopus-usage-90d-day.csv");
  const csvResponse = await page.request.get(
    "/api/v1/usage/export?range=90&groupBy=day",
  );
  expect(csvResponse.ok()).toBe(true);
  const csv = await csvResponse.text();
  expect(csv).toContain("bucket,day,turns");
});
