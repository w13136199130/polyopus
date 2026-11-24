import { expect, test } from "@playwright/test";

/** V1-04: admin user CRUD, role assignment and invite lifecycle. */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("admin: create user, change role, delete", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-users").click();

  const name = `e2e-user-${Date.now()}`;
  await page.getByTestId("admin-new-user").click();
  const dialog = page.getByRole("dialog", { name: "新建用户" });
  await dialog.getByTestId("admin-new-username").fill(name);
  await dialog.getByTestId("admin-new-email").fill(`${name}@example.com`);
  await dialog.getByTestId("admin-new-password").fill("e2e-password");
  await dialog.getByTestId("admin-create-user").click();
  await expect(dialog).toHaveCount(0);

  await page.getByTestId("admin-user-search").fill(name);
  const row = page.getByTestId("admin-user-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`${name}@example.com`);

  await row.getByTestId("admin-edit-user").click();
  const edit = page.getByRole("dialog", { name: "编辑用户" });
  await edit.getByTestId("admin-edit-role").selectOption("auditor");
  await edit.getByTestId("admin-save-user").click();
  await expect(row).toContainText("只读审计");

  await row.getByTestId("admin-delete-user").click();
  await page.getByTestId("confirm-admin-delete").click();
  await expect(row).toHaveCount(0);
});

test("admin: create and revoke an invite", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-users").click();

  const email = `e2e-${Date.now()}@example.com`;
  await page.getByTestId("admin-invite-open").click();
  const dialog = page.getByRole("dialog", { name: "邀请用户" });
  await dialog.getByTestId("admin-invite-email").fill(email);
  await dialog.getByTestId("admin-create-invite").click();

  await expect(dialog.getByTestId("admin-invite-token")).toBeVisible();
  const row = dialog.getByTestId("admin-invite-row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByTestId("admin-invite-revoke").click();
  await expect(row).toContainText("revoked");
});

/** P2-7: quotas (users sub-tab), audit (security sub-tab), backup (app). */
test("admin: quota create/edit, audit filter, backup create", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-users").click();

  // quotas: create a user quota, then edit its limit inline
  await page.getByTestId("admin-subtab-quotas").click();
  await page.getByTestId("quota-scope-id").fill("us_console_e2e");
  await page.getByTestId("quota-limit").fill("5");
  await page.getByTestId("quota-create").click();
  const quotaRow = page.getByTestId("quota-row").filter({ hasText: "us_console_e2e" });
  await expect(quotaRow).toBeVisible({ timeout: 10_000 });
  await quotaRow.getByTestId("quota-edit").click();
  await quotaRow.getByTestId("quota-limit-edit").fill("0");
  await quotaRow.getByTestId("quota-save").click();
  await expect(page.getByText("已更新限额")).toBeVisible();
  await expect(quotaRow).toContainText("不限");

  // audit: filter by user.create from earlier admin actions
  await page.getByTestId("admin-tab-security").click();
  await page.getByTestId("admin-subtab-audit").click();
  await page.getByTestId("audit-action").fill("user.create");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audit-row").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("audit-row").first()).toContainText("user.create");

  // backup: create -> ready in 应用设置 / 备份与恢复
  await page.getByTestId("admin-tab-app").click();
  await page.getByTestId("admin-subtab-backup").click();
  await page.getByTestId("backup-create").click();
  const backupRow = page.getByTestId("backup-row").first();
  await expect(backupRow.locator("span", { hasText: "ready" })).toBeVisible({
    timeout: 20_000,
  });
});

/** admin-bulk 原型: 批量禁用逐项结果 + CSV dry-run 预览（重复行跳过）。 */
test("admin: bulk disable and CSV dry-run preview", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-users").click();

  // create two throwaway users
  const stamp = Date.now();
  for (const name of [`bulk-a-${stamp}`, `bulk-b-${stamp}`]) {
    const created = await page.request.post("/api/v1/users", {
      data: { username: name, password: "bulk-pass-1", roles: ["member"] },
    });
    expect(created.ok()).toBe(true);
  }
  await page.reload();
  await page.getByTestId("admin-tab-users").click();

  // select ONLY the throwaway users — disabling the session owner would
  // revoke our own session (correct behavior, but it ends the test)
  for (const name of [`bulk-a-${stamp}`, `bulk-b-${stamp}`]) {
    await page.getByTestId("admin-user-search").fill(name);
    await page.locator('[data-testid="admin-user-row"]', { hasText: name })
      .getByTestId("admin-user-check").check();
  }
  await page.getByTestId("admin-user-search").fill("");
  await expect(page.getByTestId("admin-bulkbar")).toContainText("已选 2 项");
  await page.getByTestId("admin-bulkbar").getByRole("button", { name: "禁用" }).click();
  await expect(page.getByText(/批量禁用：成功 2 · 失败 0/)).toBeVisible({
    timeout: 30_000,
  });

  // CSV dry-run: one new row (create) + one duplicate (skip)
  const csv = `username,display_name,role,email\n`
    + `csv-user-${stamp},CSV User,member,csv@example.com\n`
    + `admin,Admin,admin,admin@example.com\n`;
  await page.getByTestId("admin-csv-open").click();
  const dialog = page.getByRole("dialog", { name: "批量导入用户" });
  await dialog.getByTestId("admin-csv-file").setInputFiles({
    name: "users.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8"),
  });
  await expect(dialog.getByTestId("admin-csv-summary")).toContainText("可创建 1", {
    timeout: 10_000,
  });
  await expect(dialog.getByTestId("admin-csv-summary")).toContainText("跳过 1");
  const rows = dialog.getByTestId("admin-csv-row");
  await expect(rows).toHaveCount(2);

  // confirm import: the create row lands; the duplicate never does
  await dialog.getByTestId("admin-csv-import").click();
  await expect(page.getByText(/CSV 导入：成功 1 · 失败 0/)).toBeVisible({
    timeout: 30_000,
  });
});
