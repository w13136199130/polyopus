import { expect, test } from "@playwright/test";

/**
 * V05-06 acceptance: the kit page fits 1280 and 1024 without horizontal
 * overflow, and the Radix dialog really traps focus / closes on Esc.
 */
for (const width of [1280, 1024]) {
  test(`kit page has no horizontal overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/__kit");
    await expect(page.getByRole("heading", { name: "UI Kit", level: 1 })).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `scrollWidth exceeds viewport by ${overflow}px`).toBeLessThanOrEqual(0);

    await page.screenshot({ path: `.screenshots/kit-${width}.png`, fullPage: true });
  });
}

test("dialog traps focus and closes on Escape", async ({ page }) => {
  await page.goto("/__kit");
  await page.getByRole("button", { name: "打开对话框" }).click();

  const dialog = page.getByRole("dialog", { name: "确认操作" });
  await expect(dialog).toBeVisible();

  // focus is inside the dialog and Tab keeps cycling within it
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog !== null && dialog.contains(document.activeElement);
    });
    expect(inside).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("drawer opens and closes", async ({ page }) => {
  await page.goto("/__kit");
  await page.getByRole("button", { name: "打开抽屉" }).click();
  const drawer = page.getByRole("dialog", { name: "详情抽屉" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("dark theme applies via prefers-color-scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/__kit");
  await expect(page.getByRole("heading", { name: "UI Kit", level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: ".screenshots/kit-dark-1280.png", fullPage: true });
});
