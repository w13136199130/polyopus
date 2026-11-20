import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** Personal settings: appearance preferences persist; account keeps the
 * read-only system snapshot and step-up API key flow. */
test("settings: appearance preferences and step-up key create", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "个人设置", level: 1 })).toBeVisible();

  // theme -> palette -> density, all applied immediately and persisted
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTestId("palette-rose").click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "rose");
  await page.getByRole("button", { name: "紧凑" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "rose");

  // display name saves to the server and refreshes the session
  const name = `E2E 管理员 ${Date.now()}`;
  await page.getByTestId("display-name").fill(name);
  await page.getByTestId("profile-save").click();
  await expect(page.getByText("显示名称已保存")).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByTestId("display-name").fill("admin");
  await page.getByTestId("profile-save").click();

  // account tab: system snapshot + step-up API key
  await page.getByTestId("settings-tab-account").click();
  await expect(page.getByText("系统（只读）")).toBeVisible();
  await expect(page.getByText("审计保留")).toBeVisible();

  await page.getByTestId("reauth-password").fill(PASSWORD);
  await page.getByTestId("reauth-submit").click();
  await expect(page.getByText("已认证")).toBeVisible();

  await page.getByTestId("api-key-name").fill(`e2e-key-${Date.now()}`);
  await page.getByTestId("api-key-create").click();
  await expect(page.getByTestId("api-key-secret")).toContainText("poly_");
});
