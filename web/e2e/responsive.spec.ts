import { expect, test } from "@playwright/test";

/**
 * P2-8 responsive pass: the real pages (not just the kit) must fit 1280 and
 * 1024 with no horizontal overflow. Pages with a side rail (chat) and the
 * tabbed console pages are the widest-risk layouts.
 */

const PASSWORD = "chat-e2e";
const PAGES: Array<[string, string]> = [
  ["/tasks", "任务"],
  ["/automation", "自动化"],
  ["/notifications", "通知"],
  ["/agents", "专家"],
  ["/knowledge", "知识"],
  ["/extensions", "扩展"],
  ["/admin", "管理"],
  ["/settings", "个人设置"],
];

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

for (const width of [1280, 1024]) {
  test(`main pages have no horizontal overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await login(page);
    for (const [route, label] of PAGES) {
      await page.goto(route);
      await page.getByRole("heading", { name: label, level: 1 }).waitFor();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
}

test("rail collapses and persists across reloads", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("rail-collapse")).toBeVisible();
  const chatLink = page.getByRole("link", { name: "对话" });
  // collapsed mode keeps the link reachable (title = accessible name) but
  // hides the visible label span — icons-only rail
  const label = chatLink.locator("span").first();
  await page.getByTestId("rail-collapse").click();
  await expect(label).toBeHidden();
  await page.reload();
  await expect(label).toBeHidden();
  await page.getByTestId("rail-collapse").click();
  await expect(label).toBeVisible();
});

test("mobile: bottom navigation replaces the rail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const mobile = page.getByRole("navigation", { name: "移动端导航" });
  await expect(mobile).toBeVisible();
  await expect(page.getByTestId("rail-collapse")).toBeHidden();

  // chat on mobile: the session rail becomes a drawer
  await page.getByTestId("mobile-sessions").click();
  const sessions = page.getByRole("dialog", { name: "会话" });
  await expect(sessions).toBeVisible();
  await sessions.getByRole("button", { name: "关闭" }).click();

  await mobile.getByRole("link", { name: /任务/ }).click();
  await page.waitForURL("**/tasks");
  await expect(page.getByRole("heading", { name: "任务", level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // mobile tasks: list -> detail -> back, without a second column
  await page.getByTestId("new-ticket").click();
  await page.getByTestId("new-ticket-title").fill(`移动端任务 ${Date.now()}`);
  await page.getByTestId("new-ticket-submit").click();
  await page.waitForURL(/ticketId=/);
  await expect(page.getByTestId("ticket-detail")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("ticket-detail")).toBeHidden();
});

test("error page: unknown route offers a way back", async ({ page }) => {
  await login(page);
  await page.goto("/definitely-not-a-page");
  await expect(page.getByTestId("error-page-404")).toBeVisible();
  await page.getByRole("link", { name: "回到对话" }).click();
  await page.waitForURL("**/chat");
});


test("mobile: main pages do not overflow at 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const [route, label] of PAGES) {
    await page.goto(route);
    await page.getByRole("heading", { name: label, level: 1 }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test("command palette: ⌘K opens, searches and navigates", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder("搜索页面或动作…").fill("任务");
  await palette.getByRole("button", { name: /^任务 / }).click();
  await page.waitForURL("**/tasks");
});
