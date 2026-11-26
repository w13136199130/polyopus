import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** v1.1 orchestration slice 1: the roster page is reachable and read-only. */
test("teams: read-only roster is reachable from the experts page", async ({ page }) => {
  await login(page);
  await page.goto("/agents");
  await page.getByRole("tab", { name: "我的团队" }).click();
  await expect(page).toHaveURL(/tab=team/);
  await expect(page.getByTestId("teams-page")).toBeVisible();
});
