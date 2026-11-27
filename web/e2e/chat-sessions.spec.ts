import { expect, test } from "@playwright/test";

/** Session/action/composer/Dock parity with the prototype chat screen. */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

async function newThread(page: import("@playwright/test").Page) {
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  return new URL(page.url()).searchParams.get("threadId")!;
}

test("chat: rail groups conversations by expert and creates with the selection", async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const nameA = `阿排序专家 ${stamp}`;
  const nameZ = `周排序专家 ${stamp}`;
  let agentZ = "";
  for (const name of [nameA, nameZ]) {
    const created = await page.request.post("/api/v1/agents", { data: { name } });
    const agentId = (await created.json()).agentId as string;
    await page.request.post(`/api/v1/agents/${agentId}/publish`);
    if (name === nameZ) agentZ = agentId;
  }
  const threadTitle = `专家会话 ${stamp}`;
  const thread = await page.request.post("/api/v1/threads", {
    data: { title: threadTitle, agentId: agentZ },
  });
  expect(thread.status()).toBe(201);

  await page.goto("/chat");
  await expect(page.getByTestId("rail-tab-expert")).toBeVisible();
  const picks = page.getByTestId("expert-pick");
  const groupZ = picks.filter({ hasText: nameZ });
  await expect(groupZ).toBeVisible();
  // the expert's conversation is nested under its own group
  const groupBox = page.getByTestId("new-chat-agent");
  await expect(groupBox.getByText(threadTitle)).toBeVisible();

  // A new conversation must not hoist that expert: order stays by name.
  const labels = await picks.allTextContents();
  const indexA = labels.findIndex((text) => text.includes(nameA));
  const indexZ = labels.findIndex((text) => text.includes(nameZ));
  expect(indexA).toBeGreaterThanOrEqual(0);
  expect(indexZ).toBeGreaterThan(indexA);

  await groupZ.click();
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  await expect(page.getByTestId("chat-agent-chip")).toHaveText(nameZ);

  await page.getByTestId("rail-tab-team").click();
  await expect(page.getByTestId("rail-team-open")).toBeVisible();
  await page.getByTestId("rail-tab-cloud").click();
  await expect(page.getByText("云端协同随 v1.1 提供")).toBeVisible();

  // 创建专家 deep link opens the create drawer on the experts page
  await page.getByTestId("rail-tab-expert").click();
  await page.getByTestId("rail-create-expert").click();
  await expect(page.getByRole("dialog", { name: "新建专家" })).toBeVisible();
});

test("chat: session menu renames, pins, branches and deletes", async ({ page }) => {
  await login(page);
  const threadId = await newThread(page);
  const header = page.getByTestId("chat-header");

  // rename through the header ⋯ menu
  await header.getByTestId("thread-menu").click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const dialog = page.getByRole("dialog", { name: "重命名会话" });
  await dialog.getByLabel("会话名称").fill("周报数据核对");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(header).toContainText("周报数据核对");

  // pin: API truth + 置顶 group label in the rail
  await header.getByTestId("thread-menu").click();
  await page.getByRole("menuitem", { name: "置顶" }).click();
  await expect
    .poll(async () => {
      const body = await (await page.request.get("/api/v1/threads")).json();
      return body.items.find((item: { threadId: string }) => item.threadId === threadId)
        ?.pinned;
    })
    .toBe(true);
  await expect(page.getByText("置顶", { exact: true }).first()).toBeVisible();

  // branch: a new URL, a 分支 title, and branchOf on the wire
  await header.getByTestId("thread-menu").click();
  await page.getByRole("menuitem", { name: "创建分支" }).click();
  await page.waitForFunction(
    (source) =>
      new URL(window.location.href).searchParams.get("threadId") !== source,
    threadId,
  );
  const branchId = new URL(page.url()).searchParams.get("threadId")!;
  await expect(header).toContainText("（分支）");
  const branch = await (await page.request.get("/api/v1/threads")).json();
  const clone = branch.items.find(
    (item: { threadId: string }) => item.threadId === branchId,
  );
  expect(clone.branchOf).toBe(threadId);

  // delete: dialog confirm, URL clears, list drops it
  await header.getByTestId("thread-menu").click();
  await page.getByRole("menuitem", { name: "删除会话" }).click();
  const confirm = page.getByRole("dialog", { name: "删除这段会话？" });
  await expect(confirm.getByRole("button", { name: "删除并整理" })).toBeVisible();
  await confirm.getByRole("button", { name: "只删除" }).click();
  await expect(page).not.toHaveURL(/threadId=/);
  const after = await (await page.request.get("/api/v1/threads")).json();
  expect(after.items.some((item: { threadId: string }) => item.threadId === branchId))
    .toBe(false);
});

test("chat: composer KB/approval/attachment/@// menus work and persist", async ({ page }) => {
  await login(page);
  const kbName = `E2E 会话知识库 ${Date.now()}`;
  const created = await page.request.post("/api/v1/knowledge-bases", {
    data: { name: kbName },
  });
  expect(created.ok()).toBe(true);
  // the chat page already fetched its KB list before this API-only create
  await page.reload();
  await page.waitForURL("**/chat");

  const threadId = await newThread(page);

  // knowledge base chip -> checkbox -> count, persists across reload
  await page.getByTestId("composer-kb").click();
  const popover = page.getByRole("dialog", { name: "输入选项" });
  await expect(popover).toBeVisible();
  await popover.getByRole("checkbox").first().click();
  await expect(page.getByTestId("composer-kb")).toContainText("知识库 · 1");
  await page.getByTestId("chat-header").click(); // close popover

  // approval policy -> 全允许 (engine upgrades ask only; deny still wins)
  await page.getByTestId("composer-approval").click();
  await page.getByRole("dialog", { name: "输入选项" })
    .getByRole("button", { name: /本会话全允许/ })
    .click();
  await expect(page.getByTestId("composer-approval")).toContainText("全允许");
  // the assertion above is optimistic; wait for the PATCH before reload
  await expect
    .poll(async () => {
      const body = await (await page.request.get("/api/v1/threads")).json();
      return body.items.find(
        (item: { threadId: string }) => item.threadId === threadId,
      )?.settings?.approvalPolicy;
    })
    .toBe("auto");

  await page.reload();
  await expect(page.getByTestId("composer-kb")).toContainText("知识库 · 1");
  await expect(page.getByTestId("composer-approval")).toContainText("全允许");

  // attachment: text file becomes a removable chip, content joins the turn
  await page.getByTestId("composer-file").setInputFiles({
    name: "笔记.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附件里的内容"),
  });
  await expect(page.getByText("笔记.txt")).toBeVisible();
  await page.getByRole("button", { name: "移除附件 笔记.txt" }).click();
  await expect(page.getByText("笔记.txt")).toHaveCount(0);

  // @ menu inserts a reference at the caret
  await page.getByRole("button", { name: "提及" }).click();
  await page.getByRole("dialog", { name: "输入选项" })
    .getByRole("button", { name: new RegExp(kbName) })
    .click();
  await expect(page.getByLabel("消息输入框")).toHaveValue(new RegExp(`@${kbName}`));

  // /plan switches the composer into Plan mode
  await page.getByRole("button", { name: "命令" }).click();
  await page.getByRole("dialog", { name: "输入选项" })
    .getByRole("button", { name: /\/plan/ })
    .click();
  await expect(page.getByTestId("composer-mode")).toContainText("Plan");
});

test("chat: Dock opens files/trace/terminal and persists its state", async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const uniqueFile = `WORKSPACE-E2E-${stamp}.md`;
  const agent = await page.request.post("/api/v1/agents", {
    data: { name: `工作区专家 ${stamp}` },
  });
  const agentId = (await agent.json()).agentId as string;
  await page.request.post(`/api/v1/agents/${agentId}/publish`);
  expect((await page.request.put(
    `/api/v1/agents/${agentId}/files/${uniqueFile}`,
    { data: { content: "workspace e2e" } },
  )).status()).toBe(200);
  await newThread(page);

  const box = page.getByLabel("消息输入框");
  await box.fill("hello dock parity");
  await box.press("Enter");
  await expect(page.getByTestId("bubble-assistant").first()).toContainText(
    "echo[",
    { timeout: 20_000 },
  );

  await page.getByTestId("dock-toggle").click();
  await expect(page.getByTestId("dock-files")).toHaveAttribute("aria-selected", "true");

  // 工作区 exposes the tenant-scoped expert system dir, and files preview
  await page.getByTestId("dock-workspace").click();
  await expect(page.getByText(".polyopus")).toBeVisible();
  await page.getByRole("button", { name: uniqueFile }).click();
  await expect(page.getByText("workspace e2e")).toBeVisible();
  await page.getByRole("button", { name: "关闭预览" }).click();

  await page.getByTestId("dock-trace").click();
  await expect(page.getByTestId("dock-trace")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("trace-row").first()).toBeVisible();
  await page.getByTestId("trace-row").first().locator("summary").click();
  await expect(page.getByTestId("trace-row").first()).toContainText("seq");

  // full explorer: turn-grouped list + record input/output/raw detail
  await page.getByTestId("trace-open-full").click();
  await expect(page.getByTestId("trace-explorer")).toBeVisible();
  await expect(page.getByTestId("trace-item").first()).toContainText("用户");
  await page.getByTestId("trace-item").last().click();
  await expect(page.getByTestId("trace-detail")).toContainText("概览");
  await page.getByRole("tab", { name: "输出" }).click();
  await expect(page.getByTestId("trace-detail")).toContainText("输出");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("trace-explorer")).toHaveCount(0);

  await page.getByTestId("dock-terminal").click();
  await expect(
    page.getByText(/还没有工具调用|fs\.(read|write)|demo\.sleep/).first(),
  ).toBeVisible();

  await page.getByTestId("dock-browser").click();
  await expect(page.getByText("还没有浏览器会话")).toBeVisible();

  await page.getByRole("button", { name: "关闭 Dock" }).click();
  await expect(page.getByTestId("dock-files")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("dock-files")).toHaveCount(0);
});

test("chat: edit re-runs, regenerate keeps one answer, branch forks", async ({ page }) => {
  await login(page);
  const threadId = await newThread(page);
  const box = page.getByLabel("消息输入框");
  await box.fill("hello edit parity");
  await box.press("Enter");
  await expect(page.getByTestId("bubble-assistant").last()).toContainText("echo[", {
    timeout: 20_000,
  });
  // wait until the turn is terminal: edit/regenerate actions appear then
  const user = page.getByTestId("bubble-user").last();
  await expect(user.getByRole("button", { name: "编辑消息" })).toBeVisible({
    timeout: 20_000,
  });

  await user.getByRole("button", { name: "编辑消息" }).click();
  await page.getByLabel("编辑消息").fill("hello edited parity");
  await page.getByRole("button", { name: "保存并重新发送" }).click();
  await expect(page.getByTestId("bubble-user").last()).toContainText(
    "hello edited parity",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("bubble-assistant").last()).toContainText("echo[", {
    timeout: 20_000,
  });

  // regenerate: one answer remains once the new run lands
  const assistant = page.getByTestId("bubble-assistant").last();
  await expect(assistant.getByRole("button", { name: "重新生成" })).toBeVisible({
    timeout: 20_000,
  });
  await assistant.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByTestId("bubble-assistant")).toHaveCount(1, {
    timeout: 20_000,
  });
  await page.waitForTimeout(1_500);

  // branch at the (fresh) answer -> new thread URL + 分支 title
  await page.reload();
  await page.waitForURL(/threadId=/);
  const branchButton = page.getByTestId("bubble-assistant").last()
    .getByRole("button", { name: "创建分支" });
  await expect(branchButton).toBeVisible({ timeout: 20_000 });
  await branchButton.click();
  await page.waitForFunction(
    (source) =>
      new URL(window.location.href).searchParams.get("threadId") !== source,
    threadId,
  );
  await expect(page.getByTestId("chat-header")).toContainText("（分支）");
});

test("chat: knowledge citations appear on the answer", async ({ page }) => {
  await login(page);
  const name = `引用知识库 ${Date.now()}`;
  const kb = await page.request.post("/api/v1/knowledge-bases", {
    data: { name },
  });
  expect(kb.ok()).toBe(true);
  const kbId = (await kb.json()).kbId as string;
  const doc = await page.request.post(`/api/v1/knowledge-bases/${kbId}/docs`, {
    data: {
      filename: "deploy.md",
      content: "# 发布流程\n\n生产发布必须先走灰度，确认无异常后再全量。",
    },
  });
  expect(doc.ok()).toBe(true);

  await page.reload();
  await page.waitForURL("**/chat");
  await newThread(page);
  await page.getByTestId("composer-kb").click();
  await page.getByRole("dialog", { name: "输入选项" })
    .getByRole("checkbox").first().click();
  await page.getByTestId("chat-header").click();

  const box = page.getByLabel("消息输入框");
  await box.fill("生产发布流程是什么？");
  await box.press("Enter");
  await expect(page.getByTestId("citations")).toContainText(name, {
    timeout: 30_000,
  });
});

test("chat: 新建 reuses a conversation that never sent a message", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const first = new URL(page.url()).searchParams.get("threadId")!;

  await page.getByTestId("new-chat").click();
  await expect(page.getByText("当前对话还没有发送消息，已沿用这个会话。")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("threadId")).toBe(first);

  const box = page.getByLabel("消息输入框");
  await box.fill("你好");
  await box.press("Enter");
  await expect(page.getByTestId("bubble-assistant")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("new-chat").click();
  await expect.poll(
    () => new URL(page.url()).searchParams.get("threadId"),
  ).not.toBe(first);
});

test("chat: long expert groups collapse and expand", async ({ page }) => {
  await login(page);
  const name = `长列表专家 ${Date.now()}`;
  const created = await page.request.post("/api/v1/agents", { data: { name } });
  const agentId = (await created.json()).agentId as string;
  await page.request.post(`/api/v1/agents/${agentId}/publish`);
  for (let index = 1; index <= 10; index += 1) {
    await page.request.post("/api/v1/threads", {
      data: { title: `批量会话 ${index} ${Date.now()}`, agentId },
    });
  }

  await page.goto("/chat");
  const section = page.getByTestId("expert-group").filter({ hasText: name });
  await expect(section).toBeVisible();
  await expect(section.getByTestId("thread-row")).toHaveCount(8);
  await section.getByTestId("expert-more").click();
  await expect(section.getByTestId("thread-row")).toHaveCount(10);
  await expect(section.getByRole("button", { name: "收起" })).toBeVisible();
});

test("chat: rail sort modes reorder conversations inside an expert", async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const name = `排序专家 ${stamp}`;
  const created = await page.request.post("/api/v1/agents", { data: { name } });
  const agentId = (await created.json()).agentId as string;
  await page.request.post(`/api/v1/agents/${agentId}/publish`);

  async function createThread(title: string) {
    const response = await page.request.post("/api/v1/threads", {
      data: { title, agentId },
    });
    return (await response.json()).threadId as string;
  }
  await createThread(`最早会话 ${stamp}`);
  await page.waitForTimeout(1_100);
  const middle = await createThread(`中间会话 ${stamp}`);
  await page.waitForTimeout(1_100);
  await createThread(`最新会话 ${stamp}`);
  // make the middle conversation the most recently active one
  await page.request.post(`/api/v1/threads/${middle}/turns`, {
    data: { content: "更新活跃时间" },
    headers: { "Idempotency-Key": `sort-${stamp}` },
  });

  await page.goto("/chat");
  const section = page.getByTestId("expert-group").filter({ hasText: name });
  const rows = section.getByTestId("thread-row");
  await expect(rows).toHaveCount(3);
  const firstTitle = async () => (await rows.allTextContents())[0]?.trim() ?? "";

  // default: 最近对话 (middle has the newest message)
  await expect.poll(firstTitle).toContain("中间会话");
  await page.getByTestId("rail-sort").click();
  await page.getByTestId("rail-sort-created").click();
  await expect.poll(firstTitle).toContain("最新会话");
  await page.getByTestId("rail-sort").click();
  await page.getByTestId("rail-sort-oldest").click();
  await expect.poll(firstTitle).toContain("最早会话");

  // choice survives reload (localStorage)
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect.poll(firstTitle).toContain("最早会话");
});
