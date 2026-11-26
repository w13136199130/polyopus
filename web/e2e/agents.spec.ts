import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** P1-4: template create -> card grid -> publish confirm -> version badge. */
test("agents: create from template and publish", async ({ page }) => {
  await login(page);
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "专家", level: 1 })).toBeVisible();

  const name = `E2E 专家 ${Date.now()}`;
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-template").selectOption("engineer");
  await page.getByTestId("agent-name").fill(name);
  await page.getByTestId("agent-create").click();
  await expect(page.getByText(`已创建草稿 ${name}`)).toBeVisible();

  const card = page.getByTestId("agent-row").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("agent-status")).toHaveText("草稿");

  await card.getByTestId("agent-publish").click();
  const confirm = page.getByRole("dialog", { name: "发布新版本" });
  await confirm.getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByText(/已发布 .+ v1/)).toBeVisible();
  await expect(card.getByTestId("agent-status")).toHaveText("已发布 v1");

  // P0-2 regression: published expert selectable in a new chat + header chip
  await page.goto("/chat");
  await page.getByTestId("expert-pick").filter({ hasText: name }).click();
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  await expect(page.getByTestId("chat-agent-chip")).toHaveText(name);
});

/** P1-4: edit drawer — sections, draft save, publish v2 from the drawer. */
test("agents: edit drawer saves draft and publishes v2", async ({ page }) => {
  await login(page);
  await page.goto("/agents");

  const name = `抽屉专家 ${Date.now()}`;
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-name").fill(name);
  await page.getByTestId("agent-create").click();
  const card = page.getByTestId("agent-row").filter({ hasText: name });
  await expect(card).toBeVisible();

  // open the edit drawer from the card action bar
  await card.getByTestId("agent-open").click();
  const drawer = page.getByRole("dialog", { name: /编辑专家/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("agent-section-basic")).toBeVisible();

  // planned sections stay disabled with a v1.1 tag — never fake inputs
  await expect(drawer.getByRole("button", { name: /技能/ })).toBeDisabled();

  // basic section edits the description
  await drawer.getByTestId("agent-drawer-desc").fill("抽屉编辑的描述");

  // prompt section: change system prompt, save draft
  await drawer.getByTestId("agent-section-prompt").click();
  const prompt = drawer.getByTestId("agent-drawer-prompt");
  await prompt.fill("你是抽屉编辑 v2 提示词");
  await drawer.getByTestId("agent-save-draft").click();
  await expect(page.getByText(`已保存 ${name} 草稿`)).toBeVisible();

  // tools section lists bindings with toggles
  await drawer.getByTestId("agent-section-tools").click();
  await expect(drawer.getByTestId("agent-tool-toggle").first()).toBeVisible();

  // versions section: publish v1, then draft edit + publish v2
  await drawer.getByTestId("agent-section-versions").click();
  await expect(drawer.getByText(/尚未发布/)).toBeVisible();

  await drawer.getByTestId("agent-section-test").click();
  await drawer.getByTestId("agent-drawer-test-message").fill("自我介绍");
  await drawer.getByTestId("agent-drawer-test-run").click();
  await expect(page.getByText(/测试对话已创建/)).toBeVisible();

  // publish v1 then v2 through the card confirm
  await drawer.getByRole("button", { name: "关闭" }).click();
  await expect(drawer).toBeHidden();
  await card.getByTestId("agent-publish").click();
  await page.getByRole("dialog", { name: "发布新版本" })
    .getByRole("button", { name: "确认发布" }).click();
  await expect(card.getByTestId("agent-status")).toHaveText("已发布 v1");

  await card.getByTestId("agent-open").click();
  await page.getByRole("dialog", { name: /编辑专家/ })
    .getByTestId("agent-section-prompt").click();
  await page.getByRole("dialog", { name: /编辑专家/ })
    .getByTestId("agent-drawer-prompt").fill("你是抽屉编辑 v3 提示词");
  await page.getByRole("dialog", { name: /编辑专家/ })
    .getByTestId("agent-save-draft").click();
  await expect(page.getByText(`已保存 ${name} 草稿`)).toBeVisible();
  await page.getByRole("dialog", { name: /编辑专家/ })
    .getByRole("button", { name: "关闭" }).click();
  await card.getByTestId("agent-publish").click();
  await page.getByRole("dialog", { name: "发布新版本" })
    .getByRole("button", { name: "确认发布" }).click();
  await expect(card.getByTestId("agent-status")).toHaveText("已发布 v2");
});

test("agents: page tabs, search and card/table switch", async ({ page }) => {
  await login(page);
  await page.goto("/agents");

  await expect(page.getByRole("tab", { name: "我的专家" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "我的团队" }).click();
  await expect(page).toHaveURL(/tab=team/);
  await expect(page.getByTestId("teams-page")).toBeVisible();

  await page.getByRole("tab", { name: "发现专家" }).click();
  await expect(page.getByText("专家市场尚未接入")).toBeVisible();

  await page.getByRole("tab", { name: "我的专家" }).click();
  await page.getByLabel("搜索专家").fill("不存在的专家名");
  await expect(page.getByText("没有匹配的专家")).toBeVisible();
  await page.getByLabel("搜索专家").fill("");

  await page.getByTestId("view-table").click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page.getByRole("table", { name: "专家列表" })).toBeVisible();
  await page.getByTestId("view-card").click();
  await expect(page.getByTestId("agents-grid")).toBeVisible();
});

test("agents: dirty drawer asks before discarding edits", async ({ page }) => {
  await login(page);
  await page.goto("/agents");
  const name = `脏关闭专家 ${Date.now()}`;
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-name").fill(name);
  await page.getByTestId("agent-create").click();
  const card = page.getByTestId("agent-row").filter({ hasText: name });
  await expect(card).toBeVisible();

  await card.getByTestId("agent-open").click();
  const drawer = page.getByRole("dialog", { name: /编辑专家/ });
  await expect(drawer).toBeVisible();
  await drawer.getByTestId("agent-drawer-desc").fill("未保存的描述");
  await expect(drawer.getByTestId("agent-dirty")).toBeVisible();

  await drawer.getByRole("button", { name: "关闭" }).click();
  const confirm = page.getByRole("dialog", { name: "放弃未保存的修改？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续编辑" }).click();
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByTestId("agent-discard").click();
  await expect(drawer).toBeHidden();
});

test("agents: card 试运行 opens the drawer on the test section", async ({ page }) => {
  await login(page);
  await page.goto("/agents");
  const name = `试运行专家 ${Date.now()}`;
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-name").fill(name);
  await page.getByTestId("agent-create").click();
  const card = page.getByTestId("agent-row").filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.getByTestId("agent-try").click();
  const drawer = page.getByRole("dialog", { name: /编辑专家/ });
  await expect(drawer.getByTestId("agent-drawer-test-message")).toBeVisible();
});
