import { expect, test } from "@playwright/test";

/**
 * V05-03 acceptance: login -> new thread -> send -> stream (>=2 deltas via
 * the events API) -> write approval -> approve -> finish -> reload restores.
 * Runs against the FakeModel backend spun up by playwright.config.
 */

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

test("chat: send, stream, approve a write, reload restores", async ({ page }) => {
  await login(page);

  // --- create a thread; URL carries threadId (URL-as-view) ---
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const threadUrl = page.url();

  // --- plain turn: FakeModel echoes; wait for the completed projection ---
  const box = page.getByLabel("消息输入框");
  await box.fill("hello e2e chat");
  await box.press("Enter");

  const assistant = page.getByTestId("bubble-assistant");
  await expect(assistant.first()).toContainText("echo[", { timeout: 20_000 });
  await expect(page.getByTestId("bubble-user").first()).toContainText("hello e2e chat");
  // duplicate SSE connections used to double every delta ("echo[echo[")
  expect(await assistant.first().textContent()).not.toContain("echo[echo[");
  // the composer shows this thread's real usage.recorded totals
  await expect(page.getByTestId("chat-usage")).toContainText("输入", { timeout: 10_000 });

  // streaming really streamed: >=2 deltas + terminal event in the log.
  // The projection can lag the live bubble for a beat -> poll, don't race.
  const threadId = new URL(threadUrl).searchParams.get("threadId")!;
  let sse = "";
  for (let i = 0; i < 20; i += 1) {
    const eventsResponse = await page.request.get(
      `/api/v1/threads/${threadId}/events?after_seq=0`,
    );
    expect(eventsResponse.ok()).toBe(true);
    sse = await eventsResponse.text();
    if (sse.includes("turn.finished")) break;
    await page.waitForTimeout(500);
  }
  expect((sse.match(/message\.delta/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(sse).toContain("turn.finished");

  // --- write turn: policy gate pauses, approval card answers, turn ends ---
  await box.fill("请用 fs.write 工具把内容 'chat-e2e-ok' 写入 chat-e2e.txt");
  await box.press("Enter");

  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("fs.write");
  // the approval lives inside the transcript scroll flow, not below it
  await expect(page.getByTestId("message-scroll").getByTestId("approval-card"))
    .toBeVisible();

  await card.getByRole("button", { name: "仅本次允许" }).click();
  await expect(card).toBeHidden({ timeout: 20_000 });
  // resume streams a final round (FakeModel echoes the request again)
  await expect(assistant.last()).toContainText("echo[", { timeout: 20_000 });

  // rich message: the tool step and the written file are visible after the
  // turn; the trace poller decorates the assistant bubble.
  await expect(page.getByTestId("tool-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("file-card")).toContainText("chat-e2e.txt", {
    timeout: 20_000,
  });

  // --- reload: ?threadId restores the same conversation ---
  await page.reload();
  await page.waitForURL(/threadId=/);
  await expect(page.getByTestId("bubble-user").first()).toContainText(
    "hello e2e chat",
    { timeout: 20_000 },
  );
  expect(page.url()).toBe(threadUrl);
});

test("chat: denying the write leaves no approval behind", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  const box = page.getByLabel("消息输入框");
  await box.fill("请用 fs.write 工具把内容 'denied-test' 写入 denied.txt");
  await box.press("Enter");

  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "拒绝" }).click();
  await expect(card).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("bubble-assistant").last()).toContainText(
    "echo[",
    { timeout: 20_000 },
  );
});

test("chat: inflight cache paints after a refresh", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const threadId = new URL(page.url()).searchParams.get("threadId")!;

  await page.evaluate(
    ({ key, entry }) => window.sessionStorage.setItem(key, JSON.stringify(entry)),
    {
      key: `poly:inflight:${threadId}`,
      entry: {
        threadId,
        userMessageId: "msg_cached",
        turnId: "tu_cached",
        text: "刷新前的缓存尾部，不丢也不重",
        seq: 42,
        status: "streaming",
        updatedAt: Date.now(),
      },
    },
  );
  await page.reload();
  await expect(page.getByTestId("bubble-assistant").last()).toContainText(
    "刷新前的缓存尾部",
    { timeout: 20_000 },
  );
});

test("chat: 5s offline recovers the pending approval", async ({ page, context }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  const box = page.getByLabel("消息输入框");
  await box.fill("请用 fs.write 工具把内容 'offline-ok' 写入 offline.txt");
  await box.press("Enter");

  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await page.waitForTimeout(5_000);
  await context.setOffline(false);

  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "仅本次允许" }).click();
  await expect(card).toBeHidden({ timeout: 20_000 });
});

/** 交互还原 (prototype 欢迎页): quick-start cards send the prompt directly. */
test("chat: welcome quick-start sends on click", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  const welcome = page.getByTestId("quick-prompt").first();
  await expect(welcome).toBeVisible();
  await expect(page.getByTestId("composer-model")).toBeVisible();
  // prototype: at the bottom of a fresh conversation there is nothing to jump to
  await expect(page.getByTestId("scroll-bottom")).toHaveCount(0);

  await welcome.click();
  const assistant = page.getByTestId("bubble-assistant");
  await expect(assistant.first()).toContainText("echo[", { timeout: 20_000 });
  // welcome disappears once the first message lands
  await expect(page.getByTestId("quick-prompt")).toHaveCount(0);
});

test("chat: 本会话允许 covers later write turns", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const box = page.getByLabel("消息输入框");

  await box.fill("请用 fs.write 工具把内容 'session-a' 写入 session-a.txt");
  await box.press("Enter");
  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "本会话允许" }).click();
  await expect(card).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("bubble-assistant").last()).toContainText(
    "echo[",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("file-card").last()).toContainText("session-a.txt", {
    timeout: 20_000,
  });

  // The remembered tool key is now auto-approved for this conversation.
  await box.fill("请用 fs.write 工具把内容 'session-b' 写入 session-b.txt");
  await box.press("Enter");
  await expect(page.getByTestId("file-card").last()).toContainText("session-b.txt", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("approval-card")).toHaveCount(0);
  await expect(page.getByTestId("composer-stop")).toBeHidden({ timeout: 20_000 });
});

test("chat: Plan mode produces a plan card and can execute in Act", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  await page.getByTestId("composer-mode").click();
  await page.getByTestId("composer-mode-plan").click();
  await expect(page.getByTestId("composer-mode")).toContainText("Plan");

  await page.getByLabel("消息输入框").fill("帮我规划发布流程");
  await page.getByLabel("消息输入框").press("Enter");
  const card = page.getByTestId("mode-card-plan");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Plan 模式只输出计划");

  await page.getByTestId("mode-execute").click();
  await expect(page.getByTestId("bubble-user").last()).toContainText("请执行上面的计划");
  await expect(page.getByTestId("composer-mode")).toContainText("Act");
});

test("chat: Ask mode asks first and can skip into Act", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);

  await page.getByTestId("composer-mode").click();
  await page.getByTestId("composer-mode-ask").click();
  await expect(page.getByTestId("composer-mode")).toContainText("Ask");
  await page.getByLabel("消息输入框").fill("帮我整理需求");
  await page.getByLabel("消息输入框").press("Enter");

  const card = page.getByTestId("mode-card-ask");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("mode-skip").click();
  await expect(page.getByTestId("bubble-user").last()).toContainText("跳过澄清");
  await expect(page.getByTestId("composer-mode")).toContainText("Act");
});

test("chat: Plan card can turn into a ticket", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  await page.getByTestId("composer-mode").click();
  await page.getByTestId("composer-mode-plan").click();
  await page.getByLabel("消息输入框").fill("规划一次发布检查");
  await page.getByLabel("消息输入框").press("Enter");

  await expect(page.getByTestId("mode-card-plan")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("mode-ticket").click();
  await page.waitForURL(/\/tasks\?ticketId=/);
  await expect(page.getByTestId("ticket-detail")).toBeVisible({ timeout: 15_000 });
});

test("chat: side-effect turn becomes a persisted task card", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const box = page.getByLabel("消息输入框");
  await box.fill("请用 fs.write 工具把内容 'task-card-e2e' 写入 task-card.txt");
  await box.press("Enter");

  const approval = page.getByTestId("approval-card");
  await expect(approval).toBeVisible({ timeout: 20_000 });
  await approval.getByRole("button", { name: "仅本次允许" }).click();
  await expect(approval).toBeHidden({ timeout: 20_000 });

  const suggest = page.getByTestId("chat-task-suggest");
  await expect(suggest).toBeVisible({ timeout: 20_000 });
  const patched = page.waitForResponse(
    (response) => response.url().includes("/api/v1/threads/")
      && response.request().method() === "PATCH",
  );
  await suggest.getByTestId("chat-task-create").click();
  await patched;

  const card = page.getByTestId("chat-task-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("任务卡");
  const ticketId = await card.getAttribute("data-ticket-id");
  expect(ticketId).toBeTruthy();

  // mapping persists in thread settings, so reload restores the card
  await page.reload();
  await expect(page.getByTestId("chat-task-card")).toHaveAttribute("data-ticket-id", ticketId!);

  await page.getByTestId("chat-task-open").click();
  await page.waitForURL(new RegExp(`/tasks/${ticketId}`));
  await expect(page.getByTestId("ticket-detail")).toBeVisible();
});

test("chat: ignored task suggestion stays hidden after reload", async ({ page }) => {
  await login(page);
  await page.getByTestId("new-chat").click();
  await page.waitForURL(/threadId=/);
  const box = page.getByLabel("消息输入框");
  await box.fill("请用 fs.write 工具把内容 'task-ignore-e2e' 写入 task-ignore.txt");
  await box.press("Enter");

  const approval = page.getByTestId("approval-card");
  await expect(approval).toBeVisible({ timeout: 20_000 });
  await approval.getByRole("button", { name: "仅本次允许" }).click();
  await expect(approval).toBeHidden({ timeout: 20_000 });

  const suggest = page.getByTestId("chat-task-suggest");
  await expect(suggest).toBeVisible({ timeout: 20_000 });
  const patched = page.waitForResponse(
    (response) => response.url().includes("/api/v1/threads/")
      && response.request().method() === "PATCH",
  );
  await suggest.getByTestId("chat-task-dismiss").click();
  await patched;
  await expect(suggest).toHaveCount(0);

  // dismissal is written to thread settings, so a fresh load stays clean
  const threadUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("tool-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("chat-task-suggest")).toHaveCount(0);

  // leaving and re-entering the conversation behaves the same
  await page.goto("/chat");
  await page.goto(threadUrl);
  await expect(page.getByTestId("tool-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("chat-task-suggest")).toHaveCount(0);
});
