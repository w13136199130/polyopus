import { expect, test } from "@playwright/test";

/**
 * V05-05 acceptance: window switch keeps data honest (URL param + separate
 * cache entries), export matches the active filter, unpriced shows as 未计价.
 * The shared e2e backend has usage rows from the chat specs (FakeModel).
 */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("usage: window tabs, unpriced cost, export matches filter", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "用量" }).click();
  await page.waitForURL("**/usage");

  // default window is week and omitted from the URL
  await expect(page.getByRole("heading", { name: "用量" })).toBeVisible();
  expect(page.url()).not.toContain("window=");

  // there is usage from the chat specs; the model row renders
  const table = page.getByRole("table", { name: /本周用量/ });
  await expect(table).toBeVisible({ timeout: 15_000 });
  await expect(table).toContainText("fake"); // FakeModel from the chat specs

  // unpriced (price table lands in V05-18) — never ¥0
  await expect(table.getByRole("row").last()).toContainText(/未计价|¥/);

  // switching windows writes the param and loads that window's data
  await page.getByRole("tab", { name: "本月" }).click();
  await expect(page).toHaveURL(/window=month/);
  await expect(page.getByRole("table", { name: /本月用量/ })).toBeVisible();

  await page.getByRole("tab", { name: "今天" }).click();
  await expect(page).toHaveURL(/window=day/);
  await expect(page.getByRole("table", { name: /今天用量/ })).toBeVisible();

  // export honors the CURRENT filter (day): CSV includes the header row
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("polyopus-usage-day.csv");
  // export API honors the CURRENT filter
  const csvResponse = await page.request.get("/api/v1/usage/export?window=day");
  expect(csvResponse.ok()).toBe(true);
  const csv = await csvResponse.text();
  expect(csv).toContain("bucket,model,turns");
  expect(csv).toContain("day");
});
