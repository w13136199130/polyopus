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
  const confirm = page.getByRole("dialog", { name: "删除会话" });
  await confirm.getByRole("button", { name: "删除" }).click();
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

  // / command prefills a plan request
  await page.getByRole("button", { name: "命令" }).click();
  await page.getByRole("dialog", { name: "输入选项" })
    .getByRole("button", { name: /\/plan/ })
    .click();
  await expect(page.getByLabel("消息输入框")).toHaveValue(/执行计划/);
});

test("chat: Dock opens files/trace/terminal and persists its state", async ({ page }) => {
  await login(page);
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
  await page.getByTestId("dock-trace").click();
  await expect(page.getByTestId("dock-trace")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("trace-row").first()).toBeVisible();
  await page.getByTestId("trace-row").first().locator("summary").click();
  await expect(page.getByTestId("trace-row").first()).toContainText("seq");

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
