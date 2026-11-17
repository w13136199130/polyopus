import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-12: registry lists builtins; global switch persists across reload. */
test("extensions: registry and global tool switch", async ({ page }) => {
  await login(page);
  await page.goto("/extensions");
  await expect(page.getByRole("heading", { name: "扩展", level: 1 })).toBeVisible();

  const readRow = page.getByTestId("tool-row").filter({ hasText: "fs.read" });
  await expect(readRow).toBeVisible();
  const checkbox = readRow.getByTestId("tool-enabled");
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();

  await page.reload();
  const reloaded = page.getByTestId("tool-row").filter({ hasText: "fs.read" })
    .getByTestId("tool-enabled");
  await expect(reloaded).not.toBeChecked();
  await reloaded.click();
  await expect(reloaded).toBeChecked();
});
