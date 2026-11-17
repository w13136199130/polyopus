import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-11: create from template -> publish -> immutable version shown. */
test("agents: create from template and publish", async ({ page }) => {
  await login(page);
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "专家", level: 1 })).toBeVisible();

  const name = `E2E 专家 ${Date.now()}`;
  await page.getByTestId("agent-template").selectOption("engineer");
  await page.getByTestId("agent-name").fill(name);
  await page.getByTestId("agent-create").click();
  await expect(page.getByText(`已创建草稿 ${name}`)).toBeVisible();

  const row = page.getByTestId("agent-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("agent-status")).toHaveText("draft");

  await row.getByTestId("agent-publish").click();
  await expect(row.getByTestId("agent-status")).toHaveText("published");
  await expect(row).toContainText("v1");
});
