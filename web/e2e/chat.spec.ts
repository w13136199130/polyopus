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
  await page.getByRole("button", { name: "＋ 新对话" }).click();
  await page.waitForURL(/threadId=/);
  const threadUrl = page.url();

  // --- plain turn: FakeModel echoes; wait for the completed projection ---
  const box = page.getByLabel("消息输入框");
  await box.fill("hello e2e chat");
  await box.press("Enter");

  const assistant = page.getByTestId("bubble-assistant");
  await expect(assistant.first()).toContainText("echo[", { timeout: 20_000 });
  await expect(page.getByTestId("bubble-user").first()).toContainText("hello e2e chat");

  // streaming really streamed: >=2 deltas + terminal event in the log
  const threadId = new URL(threadUrl).searchParams.get("threadId")!;
  const eventsResponse = await page.request.get(
    `/api/v1/threads/${threadId}/events?after_seq=0`,
  );
  expect(eventsResponse.ok()).toBe(true);
  const sse = await eventsResponse.text();
  expect((sse.match(/message\.delta/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(sse).toContain("turn.finished");

  // --- write turn: policy gate pauses, approval card answers, turn ends ---
  await box.fill("请用 fs.write 工具把内容 'chat-e2e-ok' 写入 chat-e2e.txt");
  await box.press("Enter");

  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("fs.write");

  await card.getByRole("button", { name: "批准" }).click();
  await expect(card).toBeHidden({ timeout: 20_000 });
  // resume streams a final round (FakeModel echoes the request again)
  await expect(assistant.last()).toContainText("echo[", { timeout: 20_000 });

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
  await page.getByRole("button", { name: "＋ 新对话" }).click();
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
