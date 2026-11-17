import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-13: create KB -> upload markdown -> search returns a cited hit. */
test("knowledge: upload and retrieve with citation", async ({ page }) => {
  await login(page);
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "知识", level: 1 })).toBeVisible();

  const name = `E2E 知识库 ${Date.now()}`;
  await page.getByTestId("kb-name").fill(name);
  await page.getByTestId("kb-create").click();
  await expect(page.getByText(`已创建知识库 ${name}`)).toBeVisible();

  await page.getByTestId("doc-filename").fill("ops.md");
  await page.getByTestId("doc-content").fill(
    "# 运维\n## 备份\n每天凌晨执行全量备份，保留最近七份，恢复前校验 sha256。\n",
  );
  await page.getByTestId("doc-upload").click();
  await expect(page.getByTestId("doc-row").filter({ hasText: "ops.md" })).toBeVisible();

  await page.getByTestId("kb-query").fill("备份保留几份");
  await page.getByTestId("kb-search").click();
  await expect(page.getByTestId("kb-hit").first()).toContainText("ops.md");
  await expect(page.getByTestId("kb-hit").first()).toContainText("备份");
});
