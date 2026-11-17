import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-16: read-only system values + step-up API key creation. */
test("settings: read-only values and step-up key create", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
  await expect(page.getByText("系统（只读）")).toBeVisible();
  await expect(page.getByText("审计保留")).toBeVisible();

  await page.getByTestId("reauth-password").fill(PASSWORD);
  await page.getByTestId("reauth-submit").click();
  await expect(page.getByText("已认证")).toBeVisible();

  await page.getByTestId("api-key-name").fill(`e2e-key-${Date.now()}`);
  await page.getByTestId("api-key-create").click();
  await expect(page.getByTestId("api-key-secret")).toContainText("poly_");
});
