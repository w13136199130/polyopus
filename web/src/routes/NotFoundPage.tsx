import { PageShell } from "@/layouts/PageShell";

export function NotFoundPage() {
  return (
    <PageShell title="页面不存在">
      <p>这个地址没有对应的页面。检查链接，或从左侧导航进入。</p>
    </PageShell>
  );
}
