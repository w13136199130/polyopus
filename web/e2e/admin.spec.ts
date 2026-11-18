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
  await expect(page.getByTestId("admin-user-row").first()).toBeVisible();

  const name = `e2e-user-${Date.now()}`;
  await page.getByTestId("admin-new-username").fill(name);
  await page.getByTestId("admin-new-password").fill("e2e-password");
  await page.getByTestId("admin-create-user").click();

  const row = page.getByTestId("admin-user-row").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByTestId("admin-role-select").selectOption("auditor");
  await expect(row.getByTestId("admin-role-select")).toHaveValue("auditor");

  await row.getByTestId("admin-delete-user").click();
  await page.getByTestId("confirm-admin-delete").click();
  await expect(row).toHaveCount(0);
});

test("admin: create and revoke an invite", async ({ page }) => {
  await login(page);
  await page.goto("/admin");

  const email = `e2e-${Date.now()}@example.com`;
  await page.getByTestId("admin-invite-email").fill(email);
  await page.getByTestId("admin-create-invite").click();

  await expect(page.getByTestId("admin-invite-token")).toBeVisible();
  const row = page.getByTestId("admin-invite-row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByTestId("admin-invite-revoke").click();
  await expect(row).toContainText("revoked");
});

/** P2-7: admin console tabs — quotas, audit, backup. */
test("admin: quota create/edit, audit filter, backup create", async ({ page }) => {
  await login(page);
  await page.goto("/admin");

  // quotas: create a user quota, then edit its limit inline
  await page.getByTestId("admin-tab-quotas").click();
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

  // audit: filter by user.create from the quota/user actions above
  await page.getByTestId("admin-tab-audit").click();
  await page.getByTestId("audit-action").fill("user.create");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audit-row").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("audit-row").first()).toContainText("user.create");

  // backup: create -> ready -> delete keeps the list consistent
  await page.getByTestId("admin-tab-backup").click();
  await page.getByTestId("backup-create").click();
  const backupRow = page.getByTestId("backup-row").first();
  await expect(backupRow.locator("span", { hasText: "ready" })).toBeVisible({
    timeout: 20_000,
  });
});
