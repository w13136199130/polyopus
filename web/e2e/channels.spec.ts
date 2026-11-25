import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** v1.1: Feishu channel cards live in 连接 → 通道. */
test("channels: create, toggle and delete a Feishu channel", async ({ page }) => {
  await login(page);
  await page.goto("/connections");
  await page.getByTestId("channels-tab").click();

  const name = `E2E 飞书 ${Date.now()}`;
  await page.getByTestId("channel-new").click();
  const dialog = page.getByRole("dialog", { name: "添加飞书通道" });
  await dialog.getByTestId("channel-name").fill(name);
  await dialog.getByTestId("channel-app-id").fill("cli_e2e");
  await dialog.getByTestId("channel-app-secret").fill("secret-e2e");
  await dialog.getByTestId("channel-verification").fill("verify-e2e");
  await dialog.getByTestId("channel-approvers").fill("ou_bob, ou_carol");
  await dialog.getByTestId("channel-create").click();
  await expect(page.getByText(`已创建飞书通道「${name}」`)).toBeVisible();

  const card = page.getByTestId("channel-row").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText("已启用");
  await expect(card).toContainText("/api/v1/channels/feishu/");
  await expect(card.getByTestId("channel-approvers-view")).toContainText("ou_bob、ou_carol");

  // channel-managed backing source must not leak into the source list
  await expect(
    page.getByTestId("source-row").filter({ hasText: `飞书 · ${name}` }),
  ).toHaveCount(0);

  await card.getByTestId("channel-edit").click();
  const edit = page.getByRole("dialog", { name: "编辑飞书通道" });
  await expect(edit.getByTestId("channel-edit-name")).toHaveValue(name);
  // credentials are write-only: configured state is shown, values stay blank
  await expect(edit.getByTestId("channel-edit-app-secret")).toHaveValue("");
  await expect(edit.getByText(/已配置，留空保持不变/).first()).toBeVisible();
  await edit.getByTestId("channel-edit-approvers").fill("ou_dave");
  await edit.getByTestId("channel-edit-save").click();
  await expect(page.getByText(`已更新通道「${name}」`)).toBeVisible();
  await expect(card.getByTestId("channel-approvers-view")).toContainText("ou_dave");

  await card.getByRole("button", { name: "停用" }).click();
  await expect(card).toContainText("已停用");
  await card.getByRole("button", { name: "启用" }).click();
  await expect(card).toContainText("已启用");

  await card.getByRole("button", { name: "删除" }).click();
  const confirm = page.getByRole("dialog", { name: "删除飞书通道" });
  await confirm.getByTestId("channel-delete-confirm").click();
  await expect(card).toHaveCount(0);
});
