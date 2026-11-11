import { MigrationPage } from "../MigrationPage";

/** Real page arrives in V05-05 (summary windows + CSV export). */
export function UsagePage() {
  return (
    <MigrationPage
      title="用量"
      card="V05-05 迁移中"
      note="用量页正在迁移到新前端；按窗口汇总与导出将在该卡完成。"
    />
  );
}
