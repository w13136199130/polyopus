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
  ["/agents", "专家"],
  ["/knowledge", "知识"],
  ["/extensions", "扩展"],
  ["/admin", "管理"],
  ["/settings", "设置"],
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
