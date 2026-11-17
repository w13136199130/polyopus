import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-14: connector instance create -> probe -> delete. */
test("connections: connector create and probe", async ({ page }) => {
  await login(page);
  await page.goto("/connections");
  await page.getByTestId("connectors-tab").click();

  const name = `E2E Webhook ${Date.now()}`;
  await page.getByTestId("connector-kind").selectOption("webhook");
  await page.getByTestId("connector-name").fill(name);
  await page.getByTestId("connector-create").click();
  await expect(page.getByText(`已创建连接 ${name}`)).toBeVisible();

  const row = page.getByTestId("connector-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByTestId("connector-probe").click();
  await expect(page.getByText(`${name} 连接正常`)).toBeVisible();
});
