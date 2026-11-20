import { useEffect, useState } from "react";
import { Button, Dialog, ErrorState, Loading } from "@/components/ui";
import type { SecurityRule } from "@/lib/api/wire";
import {
  usePublishPolicy,
  useRollbackPolicy,
  useSecuritySnapshot,
} from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function ruleLabel(rule: SecurityRule): string {
  const when = rule.when;
  const ifTool = when.tool ? `tool=${String(when.tool)}`
    : Array.isArray(when.tools) ? `tools=${when.tools.join(", ")}`
      : when.risk ? `risk=${String(when.risk)}`
        : when.source ? `source=${String(when.source)}` : "any";
  return `${ifTool} → ${rule.effect}`;
}

export function AdminSecurityTab({
  onNotice, onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const query = useSecuritySnapshot();
  const publish = usePublishPolicy();
  const rollback = useRollbackPolicy();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");

  const data = query.data;
  useEffect(() => {
    if (!data) return;
    setText(JSON.stringify(data.policy.rules, null, 2));
  }, [data]);

  function openEditor() {
    if (!data) return;
    setText(JSON.stringify(data.policy.rules, null, 2));
    setEditing(true);
  }

  function savePolicy() {
    onError("");
    let rules: SecurityRule[];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("rules 必须是数组");
      rules = parsed as SecurityRule[];
    } catch (error) {
      onError(`规则 JSON 无法解析：${messageOf(error)}`);
      return;
    }
    publish.mutate(rules, {
      onSuccess: (result) => {
        setEditing(false);
        onNotice(`已发布策略 v${result.published.version}`);
      },
      onError: (error) => onError(messageOf(error)),
    });
  }

  function doRollback() {
    const version = Number(rollbackVersion);
    if (!Number.isFinite(version) || version <= 0) {
      onError("请选择要回滚的版本");
      return;
    }
    rollback.mutate(version, {
      onSuccess: () => {
        onNotice(`已回滚到策略 v${version}；只影响未来工单`);
        setRollbackVersion("");
      },
      onError: (error) => onError(messageOf(error)),
    });
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>安全策略</h2>
        <span>策略发布只影响未来工单；在途 mandate 保留其快照</span>
        <span className={styles.spacer} />
        <Button size="sm" variant="secondary" onClick={openEditor} disabled={!data}>
          编辑策略 JSON
        </Button>
      </div>

      {query.isLoading ? (
        <Loading label="载入安全姿态…" />
      ) : query.isError ? (
        <ErrorState message="安全信息加载失败" onRetry={() => void query.refetch()} />
      ) : data ? (
        <>
          <div className={styles.securityGrid}>
            {([
              ["工具审批", `写操作 ${data.posture.fileWriteApproval}`],
              ["文件访问", data.posture.workspaceJail ? "工作区 jail 强制" : "未启用"],
              ["插件签名", data.posture.pluginSignature === "required" ? "强制校验" : "可选"],
              ["MFA", data.posture.mfa === "optional" ? "可选（按账号）" : data.posture.mfa],
              ["命令防护", data.posture.commandGuard],
              ["审计保留", `${data.posture.auditRetentionDays} 天`],
              ["敏感信息扫描", data.posture.sensitiveInfoScan],
              ["技能扫描", data.posture.skillScan],
            ] as const).map(([label, value]) => (
              <div key={label} className={styles.securityCard}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>

          <div className={styles.subhead}>
            <b>工具与风险</b>
            <span>策略引擎是最终裁决；工具开关只能收紧</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>工具</th><th>风险</th><th>副作用</th><th>所需 scope</th><th>全局开关</th></tr>
              </thead>
              <tbody>
                {data.tools.map((tool) => (
                  <tr key={tool.toolKey}>
                    <td className={styles.mono}>{tool.toolKey}</td>
                    <td>{tool.risk}</td>
                    <td>{tool.sideEffects ? "是" : "否"}</td>
                    <td className={styles.mono}>{tool.requiredScope ?? "—"}</td>
                    <td>{tool.enabledGlobal ? "启用" : "禁用"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.subhead}>
            <b>当前策略 v{data.policy.version ?? "默认"}</b>
            <span>source={data.policy.source}</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>规则</th><th>优先级</th><th>匹配</th><th>动作</th></tr>
              </thead>
              <tbody>
                {data.policy.rules.map((rule) => (
                  <tr key={rule.rid}>
                    <td className={styles.mono}>{rule.rid}</td>
                    <td>{rule.priority}</td>
                    <td>{ruleLabel(rule)}</td>
                    <td>{rule.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.rollbackRow}>
            <select
              value={rollbackVersion}
              onChange={(event) => setRollbackVersion(event.target.value)}
            >
              <option value="">选择历史版本</option>
              {data.policy.history
                .filter((item) => item.version !== data.policy.version)
                .map((item) => (
                  <option key={item.version} value={item.version}>
                    v{item.version} · {item.status}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              loading={rollback.isPending}
              onClick={doRollback}
            >
              回滚
            </Button>
            <span className={styles.spacer} />
            <span className={styles.muted}>
              敏感信息扫描 / 技能扫描 / 命令防护随 v1.1 接入
            </span>
          </div>
        </>
      ) : null}

      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="编辑策略规则"
        description="JSON 数组；动作 allow/ask/deny。发布即生成新版本，不回写历史工单。"
        width={760}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>取消</Button>
            <Button
              loading={publish.isPending}
              onClick={savePolicy}
              data-testid="policy-publish"
            >
              发布新版本
            </Button>
          </>
        }
      >
        <textarea
          className={styles.policyEditor}
          rows={20}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />
      </Dialog>
    </section>
  );
}
