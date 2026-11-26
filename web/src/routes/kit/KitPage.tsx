import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Dialog,
  Donut,
  Drawer,
  Empty,
  ErrorBoundary,
  ErrorState,
  FilterBar,
  Forbidden,
  Kpi,
  Loading,
  PageLoading,
  Skeleton,
  StreamConnectingIndicator,
  Table,
  Tabs,
  ViewToggle,
  type Column,
  type ViewMode,
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
  const [tab, setTab] = useState<"mine" | "team" | "discover">("mine");
  const [scope, setScope] = useState<"all" | "local" | "cloud">("all");
  const [view, setView] = useState<ViewMode>("card");

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

      <section className={styles.section} aria-label="页内结构与过滤器">
        <h2 className={styles.h2}>Tabs / FilterBar / Chip / ViewToggle / Card / Kpi</h2>
        <Tabs
          ariaLabel="专家视图"
          items={[
            { key: "mine", label: "我的专家", badge: 6 },
            { key: "team", label: "我的团队" },
            { key: "discover", label: "发现专家" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div style={{ height: 12 }} />
        <Tabs
          ariaLabel="范围"
          variant="segmented"
          items={[
            { key: "all", label: "全部" },
            { key: "local", label: "本地" },
            { key: "cloud", label: "云端" },
          ]}
          value={scope}
          onChange={setScope}
        />
        <div style={{ height: 16 }} />
        <FilterBar
          count="共 6 个专家"
          right={
            <>
              <Chip active={scope === "all"} onClick={() => setScope("all")} count={6}>
                全部
              </Chip>
              <ViewToggle value={view} onChange={setView} />
              <Button size="sm">＋ 新建专家</Button>
            </>
          }
        >
          <Chip active={scope === "local"} onClick={() => setScope("local")} count={4}>
            本地
          </Chip>
          <Chip active={scope === "cloud"} onClick={() => setScope("cloud")} count={2}>
            云端
          </Chip>
        </FilterBar>
        <div style={{ height: 16 }} />
        <Kpi
          items={[
            { label: "TOTAL TOKENS", value: "1.28M", hint: "近 30 天" },
            { label: "输入", value: "812K" },
            { label: "输出", value: "468K" },
            { label: "缓存命中率", value: "37%" },
            { label: "对话轮数", value: "2,431" },
            { label: "均值/轮", value: "526" },
            { label: "成本", value: "¥42.10" },
          ]}
        />
        <div style={{ height: 16 }} />
        <div className={styles.grid2}>
          <Donut
            title="输入 / 输出"
            segments={[
              { label: "输入", value: 812000, color: "var(--primary)" },
              { label: "输出", value: 468000, color: "var(--green)" },
            ]}
          />
          <Card title="专家卡" subtitle="头像、ID、状态/模型/版本" footer={<span>打开 · 试运行 · ⋯</span>}>
            <p style={{ margin: 0 }}>用 Card 承载列表项或设置块。</p>
          </Card>
          <Card title="空态卡" subtitle="没有数据时的引导">
            <Empty title="还没有内容" hint="创建第一条记录试试。" />
          </Card>
        </div>
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
