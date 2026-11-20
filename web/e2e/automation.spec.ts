import { expect, test } from "@playwright/test";

/** Automation page: create/edit/toggle/run-now/history/delete a cron job. */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("automation: create, pause, run now, edit and delete a job", async ({ page }) => {
  await login(page);
  await page.goto("/tasks");
  await page.getByRole("link", { name: /自动化/ }).click();
  await page.waitForURL("**/automation");
  await expect(page.getByRole("heading", { name: "自动化", level: 1 })).toBeVisible();

  const name = `E2E 定时 ${Date.now()}`;
  await page.getByTestId("cron-new").click();
  const drawer = page.getByRole("dialog", { name: "创建定时任务" });
  await drawer.getByTestId("cron-name").fill(name);
  await drawer.getByTestId("cron-expr").fill("0 9 * * *");
  await drawer.getByTestId("cron-timezone").fill("Asia/Shanghai");
  await drawer.getByTestId("cron-text").fill("/polyopus 自动化 E2E 巡检");
  await drawer.getByTestId("cron-save").click();
  await expect(page.getByText(`已创建「${name}」`)).toBeVisible();

  const row = page.getByTestId("cron-row").filter({ hasText: name });
  await expect(row).toContainText("每天 09:00");

  // pause -> optimistic + server state
  await row.getByTestId("cron-toggle").click();
  await expect(row).toContainText("已暂停");
  await row.getByTestId("cron-toggle").click();
  await expect(row).toContainText("已启用");

  // run now -> execution notice + history entry
  const runResponse = page.waitForResponse(
    (response) => response.url().includes("/run") && response.request().method() === "POST",
  );
  await row.getByTestId("cron-run").click();
  const run = await runResponse;
  expect(run.ok()).toBe(true);
  const runBody = (await run.json()) as { ticketId: string | null };
  await expect(page.getByText(/已立即执行/)).toBeVisible({ timeout: 20_000 });
  // do not delete the job/source while its ticket is still executing
  if (runBody.ticketId) {
    await expect
      .poll(async () => {
        const body = await (await page.request.get("/api/v1/tickets")).json();
        return body.items.find(
          (item: { ticketId: string }) => item.ticketId === runBody.ticketId,
        )?.bucket;
      }, { timeout: 30_000 })
      .not.toMatch(/queued|running/);
  }
  await row.getByTestId("cron-history").click();
  const history = page.getByRole("dialog", { name: "运行记录" });
  await expect(history).toContainText("成功", { timeout: 20_000 });
  await page.keyboard.press("Escape");

  // edit name
  await row.getByTestId("cron-edit").click();
  const edit = page.getByRole("dialog", { name: "编辑定时任务" });
  const renamed = `${name} 改`;
  await edit.getByTestId("cron-name").fill(renamed);
  await edit.getByTestId("cron-save").click();
  await expect(page.getByText(`已更新「${renamed}」`)).toBeVisible();
  const renamedRow = page.getByTestId("cron-row").filter({ hasText: renamed });
  await expect(renamedRow).toBeVisible();

  // delete
  await renamedRow.getByTestId("cron-delete").click();
  const confirm = page.getByRole("dialog", { name: "删除定时任务" });
  await confirm.getByTestId("cron-delete-confirm").click();
  await expect(page.getByText(`已删除「${renamed}」`)).toBeVisible();
  await expect(page.getByTestId("cron-row").filter({ hasText: renamed })).toHaveCount(0);
});
