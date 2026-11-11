import { MigrationPage } from "../MigrationPage";

/** Real page arrives in V05-04 (inbox, four buckets, stop, detail). */
export function TasksPage() {
  return (
    <MigrationPage
      title="任务"
      card="V05-04 迁移中"
      note="任务中心正在迁移到新前端；收件箱、四桶分组与停止操作将在该卡完成。"
    />
  );
}
