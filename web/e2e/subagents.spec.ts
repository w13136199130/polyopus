import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** v1.1: select a published subagent in the composer and delegate once. */
test("subagents: delegate a read-only task from chat", async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const name = `E2E Sub ${stamp}`;
  const created = await page.request.post("/api/v1/agents", {
    data: {
      name,
      description: "只读调查子智能体",
      systemPrompt: "你负责只读调查并给出结论。",
    },
  });
  expect(created.ok()).toBe(true);
  const agent = await created.json();
  const published = await page.request.post(
    `/api/v1/agents/${agent.agentId}/publish`,
  );
  expect(published.ok()).toBe(true);

  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  await page.getByTestId("composer-subagents").click();
  const option = page.locator("label", { hasText: name })
    .getByTestId("subagent-option");
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH"
      && response.url().includes("/api/v1/threads/"),
  );
  await option.click();
  await saved;
  await expect(option).toBeChecked();
  await expect(page.getByTestId("composer-subagents")).toContainText("1");

  await page.getByLabel("消息输入框").fill("请委派子智能体读一下说明");
  await page.getByLabel("消息输入框").press("Enter");

  const card = page.getByTestId("tool-card").filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("子智能体");
  // The child output includes the parent context; args_preview only has the task.
  await expect(card).toContainText("主任务", { timeout: 20_000 });
});


/** v1.1: expert-level defaults are editable and inherited by new chats. */
test("subagents: expert defaults save and inherit into a new chat", async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const parentName = `E2E Parent ${stamp}`;
  const childName = `E2E Child ${stamp}`;
  async function createAgent(name: string) {
    const created = await page.request.post("/api/v1/agents", {
      data: { name, systemPrompt: "你负责完成分配的任务。" },
    });
    expect(created.ok()).toBe(true);
    const row = await created.json();
    const published = await page.request.post(
      `/api/v1/agents/${row.agentId}/publish`,
    );
    expect(published.ok()).toBe(true);
    return row.agentId as string;
  }
  const parentId = await createAgent(parentName);
  const childId = await createAgent(childName);

  await page.goto("/agents");
  const card = page.getByTestId("agent-row").filter({ hasText: parentName });
  await card.getByTestId("agent-open").click();
  const drawer = page.getByRole("dialog", { name: /编辑专家/ });
  await drawer.getByTestId("agent-section-subagents").click();
  await drawer.locator("label", { hasText: childName })
    .getByTestId("agent-subagent-option").check();
  await drawer.getByTestId("agent-save-subagents").click();
  await expect(page.getByText("已保存子智能体默认配置")).toBeVisible();
  await page.keyboard.press("Escape");

  const saved = await page.request.get(
    `/api/v1/agents/${parentId}/subagents`,
  );
  expect(saved.ok()).toBe(true);
  const items = (await saved.json()).items as Array<{ agentId: string }>;
  expect(items.map((item) => item.agentId)).toContain(childId);

  await page.goto("/chat");
  await page.getByTestId("expert-pick").filter({ hasText: parentName }).click();
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  await expect(page.getByTestId("composer-subagents")).toContainText("1");
});
