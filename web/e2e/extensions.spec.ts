import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** P1-6: plugins tab — example install then enable toggle on the table row. */
test("extensions: install example plugins", async ({ page }) => {
  await login(page);
  await page.goto("/extensions");
  await page.getByTestId("plugin-install-examples").click();
  await expect(page.getByTestId("plugin-row")).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByTestId("plugin-row").first()).toContainText("example.");

  // enable toggle on one row round-trips the status badge (click + result
  // assertion: uncheck()'s instant-state check races the optimistic update)
  const row = page.getByTestId("plugin-row").first();
  await row.getByTestId("plugin-enabled").click();
  await expect(row.getByText("disabled")).toBeVisible({ timeout: 10_000 });
  await expect(row.getByTestId("plugin-enabled")).not.toBeChecked();
  await row.getByTestId("plugin-enabled").click();
  await expect(row.getByTestId("plugin-enabled")).toBeChecked({
    timeout: 10_000,
  });

  await row.getByTestId("plugin-detail").click();
  const detail = page.getByRole("dialog", { name: /插件详情/ });
  await expect(detail).toContainText("权限");
  await detail.getByRole("button", { name: "关闭" }).click();

  await page.getByTestId("plugin-view-market").click();
  await expect(page.getByText("插件市场随 v1.1 接入")).toBeVisible();
  await page.getByTestId("ext-tab-skills").click();
  await expect(page.getByText("技能包运行时尚未开放")).toBeVisible();
});

/** P1-6: signed install dialog rejects a bad signature server-side (403). */
test("extensions: signed install rejects a bad signature", async ({ page }) => {
  await login(page);
  await page.goto("/extensions");
  await page.getByTestId("plugin-install-signed").click();
  const dialog = page.getByRole("dialog", { name: "安装签名插件" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("plugin-install-signature").fill("deadbeef");
  await dialog.getByTestId("plugin-install-submit").click();
  await expect(dialog.getByText(/签名|403|PLUGIN_SIGNATURE_INVALID/).first())
    .toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
});

/** P1-6: registry tab — global switch persists across reload. */
test("extensions: registry and global tool switch", async ({ page }) => {
  await login(page);
  await page.goto("/extensions");
  await page.getByTestId("ext-tab-tools").click();

  const readRow = page.getByTestId("tool-row").filter({ hasText: "fs.read" });
  await expect(readRow).toBeVisible();
  const checkbox = readRow.getByTestId("tool-enabled");
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(page.getByText("fs.read 全局停用")).toBeVisible();

  await page.reload();
  await page.getByTestId("ext-tab-tools").click();
  const reloaded = page.getByTestId("tool-row").filter({ hasText: "fs.read" })
    .getByTestId("tool-enabled");
  await expect(reloaded).not.toBeChecked();
  await reloaded.click();
  await expect(reloaded).toBeChecked();
});
