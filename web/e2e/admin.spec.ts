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
