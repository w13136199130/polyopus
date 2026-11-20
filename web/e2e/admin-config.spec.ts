import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("admin: provider create, probe failure, edit and delete", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-models").click();

  const name = `E2E Provider ${Date.now()}`;
  await page.getByTestId("provider-new").click();
  const dialog = page.getByRole("dialog", { name: "添加 Provider" });
  await dialog.getByTestId("provider-name").fill(name);
  await dialog.getByTestId("provider-base").fill("http://127.0.0.1:9/v1");
  await dialog.getByTestId("provider-key").fill("sk-e2e-secret");
  await dialog.getByTestId("provider-models").fill("e2e-model-a, e2e-model-b");
  await dialog.getByTestId("provider-save").click();
  await expect(page.getByText(`已添加 provider「${name}」`)).toBeVisible();

  const card = page.getByTestId("provider-card").filter({ hasText: name });
  await expect(card).toContainText("e2e-model-a");
  await card.getByTestId("provider-probe").click();
  await expect(card).toContainText("连接失败", { timeout: 20_000 });

  await card.getByText("配置").click();
  const edit = page.getByRole("dialog", { name: "配置 Provider" });
  await edit.getByTestId("provider-name").fill(`${name} v2`);
  await edit.getByTestId("provider-save").click();
  await expect(page.getByText(`已保存 provider「${name} v2」`)).toBeVisible();
  const renamed = page.getByTestId("provider-card").filter({ hasText: `${name} v2` });
  await expect(renamed).toBeVisible();

  await renamed.getByText("删除").click();
  const confirm = page.getByRole("dialog", { name: "删除 Provider" });
  await confirm.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText(`已删除 provider「${name} v2」`)).toBeVisible();
  await expect(page.getByTestId("provider-card").filter({ hasText: `${name} v2` }))
    .toHaveCount(0);
});

test("admin: storage snapshot and auto-backup settings", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-storage").click();
  await expect(page.getByText("控制面数据库")).toBeVisible();
  await expect(page.getByText("本地磁盘")).toBeVisible();
  await expect(page.getByText("S3")).toBeVisible();

  await page.getByTestId("backup-auto-enabled").check();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("已保存自动备份设置")).toBeVisible();
});

test("admin: security posture and policy editor are visible", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-security").click();
  await expect(page.getByText("工作区 jail 强制")).toBeVisible();
  await expect(page.getByText("fs.write")).toBeVisible();
  await expect(page.getByText(/当前策略 v/)).toBeVisible();

  await page.getByRole("button", { name: "编辑策略 JSON" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑策略规则" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("textarea")).toHaveValue(/r-deny-rm|r-ask-write/);
  await page.keyboard.press("Escape");
});

test("admin: overview aggregates health, tickets and shortcuts", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await expect(page.getByText("实例概览")).toBeVisible();
  await expect(page.getByText("活跃会话")).toBeVisible();
  await expect(page.getByText("待决 Attention")).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据地图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近审计" })).toBeVisible();
  await page.getByRole("button", { name: /模型配置/ }).click();
  await expect(page.getByTestId("admin-tab-models")).toHaveAttribute(
    "aria-selected", "true",
  );
});
