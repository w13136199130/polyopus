import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui";
import styles from "./ErrorPage.module.css";

type Code = 403 | 404 | 409 | 500;

const META: Record<Code, { title: string; body: string }> = {
  403: {
    title: "没有权限",
    body: "当前账号无权访问此页面。可以返回上一页，或联系管理员申请权限。",
  },
  404: {
    title: "页面不存在",
    body: "这个地址没有对应的页面。检查链接，或从导航回到工作区。",
  },
  409: {
    title: "内容已发生变化",
    body: "提交时数据已被其他操作更新。刷新后重试；需要时重新应用你的修改。",
  },
  500: {
    title: "服务暂时不可用",
    body: "请求没有完成。可以先重试；如果持续出现，请联系管理员查看审计与日志。",
  },
};

export function ErrorPage({
  code,
  detail,
}: {
  code: Code;
  detail?: string;
}) {
  const navigate = useNavigate();
  const meta = META[code];
  return (
    <div className={styles.wrap} role="alert" data-testid={`error-page-${code}`}>
      <section className={styles.card}>
        <span className={styles.code}>{code}</span>
        <h1>{meta.title}</h1>
        <p>{detail || meta.body}</p>
        <div className={styles.actions}>
          {code === 500 || code === 409 ? (
            <Button size="sm" onClick={() => window.location.reload()}>
              刷新重试
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回上一页
          </Button>
          <Link to="/chat" className={styles.home}>回到对话</Link>
        </div>
      </section>
    </div>
  );
}
