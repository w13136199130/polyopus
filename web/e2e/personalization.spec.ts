import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("personalization: memory create, correct, pause and delete", async ({ page }) => {
  await login(page);
  await page.goto("/personalization");
  await expect(page.getByRole("heading", { name: "个性化", level: 1 })).toBeVisible();

  const original = `偏好：回答先给结论 ${Date.now()}`;
  await page.getByTestId("memory-new").click();
  const create = page.getByRole("dialog", { name: "新增记忆" });
  await create.getByTestId("memory-text").fill(original);
  await create.getByTestId("memory-save").click();
  await expect(page.getByText("已新增记忆")).toBeVisible();

  const row = page.getByTestId("memory-row").filter({ hasText: original });
  await expect(row).toBeVisible();

  await row.getByTestId("memory-edit").click();
  const edit = page.getByRole("dialog", { name: "纠错记忆" });
  const corrected = `${original}，再给依据`;
  await edit.getByTestId("memory-text").fill(corrected);
  await edit.getByTestId("memory-save").click();
  await expect(page.getByText("已保存记忆")).toBeVisible();
  await expect(page.getByTestId("memory-row").filter({ hasText: "再给依据" })).toBeVisible();

  await page.getByTestId("memory-pause").click();
  await expect(page.getByText("已暂停记忆写入")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("memory-pause")).toBeChecked();
  await page.getByTestId("memory-pause").click();
  await expect(page.getByText("已恢复记忆写入")).toBeVisible();

  const correctedRow = page.getByTestId("memory-row").filter({ hasText: corrected });
  await correctedRow.getByTestId("memory-delete").click();
  await page.getByRole("dialog", { name: "删除记忆" })
    .getByTestId("memory-delete-confirm").click();
  await expect(page.getByText("已删除记忆")).toBeVisible();

  await page.getByTestId("personalization-tab-tools").click();
  await expect(page).toHaveURL(/tab=tools/);
  await page.getByTestId("personalization-tab-skills").click();
  await expect(page.getByText("技能随 v1.1 接入")).toBeVisible();
});
