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
  await page.getByRole("link", { name: /团队/ }).click();

  await expect(page.getByRole("heading", { name: "团队", level: 1 })).toBeVisible();
  await expect(
    page.getByText("团队编制（只读）。创建、编辑与派工随下一批开放。"),
  ).toBeVisible();
  await expect(page.getByTestId("teams-page")).toBeVisible();
});
