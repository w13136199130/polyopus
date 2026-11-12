import { useState } from "react";
import {
  Button,
  Dialog,
  Drawer,
  Empty,
  ErrorBoundary,
  ErrorState,
  Forbidden,
  Loading,
  PageLoading,
  Skeleton,
  StreamConnectingIndicator,
  Table,
  type Column,
} from "@/components/ui";
import styles from "./KitPage.module.css";

interface Row {
  id: string;
  name: string;
  state: string;
}

const ROWS: readonly Row[] = [
  { id: "tk_1", name: "修复登录 502", state: "done" },
  { id: "tk_2", name: "检查构建失败", state: "running" },
  { id: "tk_3", name: "升级依赖", state: "queued" },
];

const COLUMNS: Array<Column<Row>> = [
  { key: "id", header: "ID", render: (row) => <code>{row.id}</code>, width: "90px" },
  { key: "name", header: "标题", render: (row) => row.name },
  { key: "state", header: "状态", render: (row) => row.state, width: "90px" },
];

/**
 * UI kit gallery — the target of the Playwright overflow/a11y checks
 * (V05-06). Public and data-free on purpose; NOT in the nav model.
 */
export function KitPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <main className={styles.page}>
      <h1 className={styles.h1}>UI Kit</h1>
      <p className={styles.note}>
        V05-06 组件陈列页：Playwright 在 1280/1024 下断言无横向溢出并截图。
      </p>

      <section className={styles.section} aria-label="按钮">
        <h2 className={styles.h2}>Button</h2>
        <div className={styles.row}>
          <Button>主要</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="danger">危险</Button>
          <Button variant="ghost">幽灵</Button>
          <Button loading>提交中</Button>
          <Button disabled>禁用</Button>
          <Button size="sm">小号</Button>
        </div>
      </section>

      <section className={styles.section} aria-label="对话框与抽屉">
        <h2 className={styles.h2}>Dialog / Drawer</h2>
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            打开对话框
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            打开抽屉
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="确认操作"
          description="对话框说明文字；Esc/遮罩可关闭，焦点被圈在面板内。"
          footer={<Button onClick={() => setDialogOpen(false)}>知道了</Button>}
        >
          <p>对话框内容区。</p>
        </Dialog>
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title="详情抽屉"
          description="右侧面板；同样具备焦点圈与 Esc 关闭。"
          footer={<Button onClick={() => setDrawerOpen(false)}>关闭</Button>}
        >
          <p>抽屉内容区。</p>
        </Drawer>
      </section>

      <section className={styles.section} aria-label="表格">
        <h2 className={styles.h2}>Table</h2>
        <Table caption="工单示例" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />
      </section>

      <section className={styles.section} aria-label="四态">
        <h2 className={styles.h2}>Empty / ErrorState / Forbidden / Loading</h2>
        <div className={styles.grid2}>
          <Empty title="还没有工单" hint="创建一个 webhook 触发器试试。" />
          <ErrorState
            message="加载工单失败：HTTP 500"
            traceId="tr_demo_123"
            onRetry={() => undefined}
          />
          <Forbidden />
          <Loading />
          <PageLoading />
        </div>
      </section>

      <section className={styles.section} aria-label="骨架与流式指示">
        <h2 className={styles.h2}>Skeleton / StreamConnectingIndicator</h2>
        <Skeleton lines={4} />
        <StreamConnectingIndicator />
      </section>

      <section className={styles.section} aria-label="错误边界">
        <h2 className={styles.h2}>ErrorBoundary</h2>
        <ErrorBoundary>
          <p>子树正常渲染；崩溃时显示可重试的错误卡。</p>
        </ErrorBoundary>
      </section>
    </main>
  );
}
