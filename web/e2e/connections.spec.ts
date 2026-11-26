import { expect, test } from "@playwright/test";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** V1-14: connector instance create -> probe -> delete. */
test("connections: connector create and probe", async ({ page }) => {
  await login(page);
  await page.goto("/connections");

  const name = `E2E Webhook ${Date.now()}`;
  await page.getByTestId("connector-new").click();
  const drawer = page.getByRole("dialog", { name: /添加/ });
  await drawer.getByTestId("connector-kind").selectOption("webhook");
  await drawer.getByTestId("connector-name").fill(name);
  await drawer.getByLabel("回调 URL").fill("https://example.com/hook");
  await drawer.getByTestId("connector-save").click();
  await expect(page.getByText(`已创建连接 ${name}`)).toBeVisible();

  const row = page.getByTestId("connector-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByTestId("connector-probe").click();
  await expect(page.getByText(`${name} 配置有效（仅本地校验）`)).toBeVisible();

  // instance drawer: default-open switch persists through save
  await row.getByTestId("connector-open").click();
  const config = page.getByRole("dialog", { name });
  await config.getByLabel("对话默认选中").check();
  await config.getByTestId("connector-save").click();
  await expect(page.getByText(`已保存连接 ${name}`)).toBeVisible();
  await expect(row).toContainText("默认打开");

  // three sub-tabs, then delete through the row action
  await page.getByTestId("connector-subtab-builtin").click();
  await expect(page.getByTestId("connector-catalog-row").first()).toBeVisible();
  await page.getByTestId("connector-subtab-custom").click();
  await expect(page.getByTestId("mcp-add-card")).toBeVisible();
  await page.getByTestId("connector-subtab-enabled").click();
  await row.getByTestId("connector-delete").click();
  await page.getByRole("dialog", { name: "删除连接器" })
    .getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText(`已删除 ${name}`)).toBeVisible();
});


/** Custom MCP: visual server editor + JSON view; probe validates shape. */
test("connections: custom MCP visual/JSON drawer", async ({ page }) => {
  await login(page);
  await page.goto("/connections");

  const name = `E2E MCP ${Date.now()}`;
  await page.getByTestId("mcp-new").click();
  const drawer = page.getByRole("dialog", { name: /添加自定义 MCP/ });
  await drawer.getByTestId("connector-name").fill(name);
  await drawer.getByLabel("Server 1 URL").fill("https://mcp.example.com/mcp");
  await drawer.getByRole("tab", { name: "JSON" }).click();
  await expect(drawer.getByTestId("connector-config")).toContainText("servers");
  await drawer.getByRole("tab", { name: "可视化" }).click();
  await drawer.getByTestId("mcp-add-server").click();
  await expect(drawer.getByTestId("mcp-server-row")).toHaveCount(2);
  await drawer.getByLabel("Server 2 URL").fill("https://mcp2.example.com/mcp");
  await drawer.getByTestId("connector-save").click();
  await expect(page.getByText(`已创建连接 ${name}`)).toBeVisible();

  const row = page.getByTestId("connector-row").filter({ hasText: name });
  await row.getByTestId("connector-probe").click();
  await expect(page.getByText(`${name} 配置有效（仅本地校验）`)).toBeVisible();
});
