import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** v1.1 orchestration slice 2: create a team, run it, open the room, stop. */
test("teams: create, run and stop a team from the experts page", async ({ page }) => {
  await login(page);
  await page.goto("/agents");

  const agentName = `团队专家 ${Date.now()}`;
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-name").fill(agentName);
  await page.getByTestId("agent-create").click();
  const agentCard = page.getByTestId("agent-row").filter({ hasText: agentName });
  await expect(agentCard).toBeVisible();
  await agentCard.getByTestId("agent-publish").click();
  await page.getByRole("dialog", { name: "发布新版本" })
    .getByRole("button", { name: "确认发布" }).click();
  await expect(agentCard.getByTestId("agent-status")).toHaveText("已发布 v1");

  await page.getByRole("tab", { name: "我的团队" }).click();
  await expect(page.getByTestId("teams-page")).toBeVisible();

  const teamName = `发布保障组 ${Date.now()}`;
  await page.getByTestId("team-new").click();
  await page.getByTestId("team-name").fill(teamName);
  const member = page.getByTestId("team-member-option").filter({ hasText: agentName });
  await member.getByRole("checkbox").check();
  await page.getByTestId("team-create").click();

  const card = page.getByTestId("team-row").filter({ hasText: teamName });
  await expect(card).toBeVisible();
  await expect(card).toContainText(agentName);

  await card.getByTestId("team-run").click();
  await page.getByTestId("team-run-task").fill("核对发布说明并给出回滚步骤");
  await page.getByTestId("team-run-submit").click();
  await page.waitForURL(/\/chat\//, { timeout: 20_000 });
  await expect(page.getByLabel("消息输入框")).toBeVisible();

  await page.goto("/agents?tab=team");
  const reopened = page.getByTestId("team-row").filter({ hasText: teamName });
  await expect(reopened).toBeVisible();
  await reopened.getByRole("button", { name: "停止" }).click();
  const confirm = page.getByRole("dialog", { name: "停止团队运行" });
  await expect(confirm).toBeVisible();
  await confirm.getByTestId("team-stop-confirm").click();
  await expect(page.getByText(`已停止 ${teamName}`)).toBeVisible({ timeout: 15_000 });
});
