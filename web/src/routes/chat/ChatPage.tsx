import { MigrationPage } from "../MigrationPage";

/** Real page arrives in V05-03 (stream, composer, approval cards). */
export function ChatPage() {
  return (
    <MigrationPage
      title="对话"
      card="V05-03 迁移中"
      note="对话页正在迁移到新前端；流式、审批卡与新会话流将在该卡完成。"
    />
  );
}
