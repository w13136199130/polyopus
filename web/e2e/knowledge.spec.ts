import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PASSWORD = "chat-e2e";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL("**/chat");
}

/** P1-5: create KB -> real file upload -> preview -> retrieval -> batch delete. */
test("knowledge: file upload, preview, retrieval and batch delete", async ({ page }) => {
  await login(page);
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "知识库", level: 1 })).toBeVisible();

  const name = `E2E 知识库 ${Date.now()}`;
  await page.getByTestId("kb-new").click();
  await page.getByTestId("kb-name").fill(name);
  await page.getByTestId("kb-create").click();
  await expect(page.getByText(`已创建知识库 ${name}`)).toBeVisible();

  // real file upload through the picker
  const tmp = path.join(
    os.tmpdir(), `kb-e2e-${Date.now()}.md`,
  );
  fs.writeFileSync(
    tmp,
    "# 运维\n## 备份\n每天凌晨执行全量备份，保留最近七份，恢复前校验 sha256。\n## 升级\n升级前执行 poly migrate --check。\n",
    "utf-8",
  );
  await page.getByTestId("kb-pick-files").click();
  await page.setInputFiles("input[data-testid=kb-file-input]", tmp);
  await expect(
    page.getByTestId("doc-card").filter({ hasText: path.basename(tmp) }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("已上传 1 个文档")).toBeVisible();

  // paste path still works for quick text
  await page.getByTestId("kb-paste-toggle").click();
  await page.getByTestId("doc-filename").fill("ops.md");
  await page.getByTestId("doc-content").fill(
    "# 运维\n## 备份\n每天备份，保留七份。\n",
  );
  await page.getByTestId("doc-upload").click();
  await expect(page.getByText(/已上传 ops.md/)).toBeVisible();

  // preview opens the chunk drawer
  await page.getByTestId("doc-card").filter({ hasText: "ops.md" }).getByTestId("doc-preview").click();
  const drawer = page.getByRole("dialog", { name: "文档预览" });
  await expect(drawer).toContainText("备份", { timeout: 15_000 });
  await drawer.getByRole("button", { name: "关闭" }).click();
  await expect(drawer).toBeHidden();

  // retrieval test tab returns a cited hit
  await page.getByTestId("kb-tab-retrieval").click();
  await page.getByTestId("kb-query").fill("备份保留几份");
  await page.getByTestId("kb-search").click();
  await expect(page.getByTestId("kb-hit").first()).toContainText("ops.md");
  await expect(page.getByTestId("kb-hit").first()).toContainText("备份");

  // batch delete: switch to table, select both docs, remove
  await page.getByTestId("kb-tab-docs").click();
  await page.getByTestId("doc-view-table").click();
  await page.getByRole("checkbox", { name: "全选文档" }).click();
  await expect(page.getByText("已选 2 项")).toBeVisible();
  await page.getByTestId("doc-batch-reindex").click();
  await expect(page.getByText("已重建 2 个文档的索引")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("checkbox", { name: "全选文档" }).click();
  await page.getByTestId("doc-batch-delete").click();
  await expect(page.getByText("已删除 2 个文档")).toBeVisible({ timeout: 15_000 });

  // settings drawer: stats + reindex + kb delete
  await page.getByTestId("kb-settings-open").click();
  const settings = page.getByRole("dialog", { name: "知识库设置" });
  await expect(settings.getByText("文档数")).toBeVisible();
  await settings.getByTestId("kb-reindex").click();
  await expect(page.getByText("索引已重建")).toBeVisible({ timeout: 15_000 });
  await settings.getByTestId("kb-delete").click();
  await page.getByRole("dialog", { name: "确认删除知识库" })
    .getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText(`已删除 ${name}`)).toBeVisible();
});

/** 交互还原 (knowledge-debug): pipeline chips + per-doc 重建 on the doc row. */
test("knowledge: pipeline chips and per-doc reindex", async ({ page }) => {
  await login(page);
  await page.goto("/knowledge");

  const name = `E2E 管线 ${Date.now()}`;
  await page.getByTestId("kb-new").click();
  await page.getByTestId("kb-name").fill(name);
  await page.getByTestId("kb-create").click();
  await expect(page.getByText(`已创建知识库 ${name}`)).toBeVisible();

  await page.getByTestId("kb-paste-toggle").click();
  await page.getByTestId("doc-filename").fill("pipeline.md");
  await page.getByTestId("doc-content").fill(
    "# 运维\n## 备份\n每天备份，保留七份。\n",
  );
  await page.getByTestId("doc-upload").click();
  const row = page.getByTestId("doc-card").filter({ hasText: "pipeline.md" });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // document search + card view
  await page.getByTestId("doc-search").fill("pipeline");
  await expect(row).toBeVisible();
  await page.getByTestId("doc-search").fill("missing-file");
  await expect(page.getByText("没有匹配的文档")).toBeVisible();
  await page.getByTestId("doc-search").fill("");
  await page.getByTestId("doc-view-card").click();
  await expect(page.getByTestId("doc-card").filter({ hasText: "pipeline.md" })).toBeVisible();
  await page.getByTestId("doc-view-table").click();

  // retrieval: pipeline chips with latency + hit, ranked rows with score bar
  await page.getByTestId("kb-tab-retrieval").click();
  await page.getByTestId("kb-query").fill("备份保留几份");
  await page.getByTestId("kb-search").click();
  await expect(page.getByTestId("kb-pipeline")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("kb-pipeline")).toContainText("ms");
  await expect(page.getByTestId("kb-pipeline")).toContainText("命中", {
    ignoreCase: false,
  });
  await expect(page.getByTestId("kb-pipeline")).not.toContainText("无命中");
  await expect(page.getByTestId("kb-hit").first()).toContainText("#1");

  // per-doc reindex from the doc row (摄取队列行内操作)
  await page.getByTestId("kb-tab-docs").click();
  await page.getByTestId("doc-view-card").click();
  await page.getByTestId("doc-card").filter({ hasText: "pipeline.md" })
    .getByTestId("doc-reindex").click();
  await expect(page.getByText("已重建 pipeline.md 的索引")).toBeVisible({
    timeout: 15_000,
  });
});
