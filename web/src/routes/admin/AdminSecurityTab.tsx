/** Admin → 安全防护: tool approval, file access, scans and audit. */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Dialog, ErrorState, Loading, Tabs } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import type { SecurityRule } from "@/lib/api/wire";
import {
  usePublishPolicy,
  useRollbackPolicy,
  useSecuritySnapshot,
} from "@/features/admin/api";
import { AdminAuditTab } from "./AdminAuditTab";
import styles from "./AdminConfig.module.css";

type SubTab = "approval" | "files" | "pii" | "command" | "skill" | "audit";

const SUB_TABS: ReadonlyArray<readonly [SubTab, string]> = [
  ["approval", "工具审批"],
  ["files", "文件访问"],
  ["pii", "敏感信息"],
  ["command", "命令防护"],
  ["skill", "技能扫描"],
  ["audit", "审计"],
];

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

function effectTone(effect: string): string {
  if (effect === "deny") return styles.badgeRed;
  if (effect === "ask") return styles.badgeAmber;
  return styles.badgeGreen;
}

export function AdminSecurityTab({
  onNotice, onError, editorSignal,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  editorSignal: number;
}) {
  const query = useSecuritySnapshot();
  const publish = usePublishPolicy();
  const rollback = useRollbackPolicy();
  const canAudit = useCan("audit:read");
  const [params, setParams] = useSearchParams();
  const subParam = params.get("sub");
  const availableTabs = SUB_TABS.filter(([key]) => key !== "audit" || canAudit);
  const sub: SubTab = availableTabs.some(([key]) => key === subParam)
    ? (subParam as SubTab)
    : "approval";
  const setSub = (next: SubTab) => {
    const query = new URLSearchParams(params);
    if (next === "approval") query.delete("sub");
    else query.set("sub", next);
    setParams(query, { replace: true });
  };
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");

  const data = query.data;

  useEffect(() => {
    if (!data) return;
    setText(JSON.stringify(data.policy.rules, null, 2));
  }, [data]);

  const seenEditor = useRef(editorSignal);
  useEffect(() => {
    if (editorSignal === seenEditor.current || !data) return;
    seenEditor.current = editorSignal;
    setText(JSON.stringify(data.policy.rules, null, 2));
    setEditing(true);
  }, [editorSignal, data]);

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

  const askTools = data
    ? Array.from(new Set([
      ...data.tools
        .filter((tool) => tool.sideEffects && tool.risk !== "critical")
        .map((tool) => tool.toolKey),
      ...data.policy.rules
        .filter((rule) => rule.effect === "ask")
        .flatMap((rule) => {
          const when = rule.when;
          if (typeof when.tool === "string") return [when.tool];
          if (Array.isArray(when.tools)) return when.tools.map(String);
          return [];
        }),
    ]))
    : [];
  const fsTools = data?.tools.filter((tool) =>
    tool.toolKey.startsWith("fs.") || tool.requiredScope?.includes("fs")) ?? [];
  const shellTools = data?.tools.filter((tool) => /shell|exec|bash/i.test(tool.toolKey)) ?? [];

  return (
    <div className={styles.page}>
      <Tabs
        ariaLabel="安全防护"
        variant="segmented"
        value={sub}
        onChange={setSub}
        items={availableTabs.map(([key, label]) => ({
          key,
          label,
          testId: `admin-subtab-${key}`,
        }))}
      />

      {query.isLoading ? <Loading label="载入安全姿态…" /> : query.isError ? (
        <ErrorState message="安全信息加载失败" onRetry={() => void query.refetch()} />
      ) : data ? (
        <>
          {sub === "approval" ? (
            <>
              <section className={styles.panel}>
                <div className={styles.toggleRow}>
                  <div>
                    <b>启用工具人工审批</b>
                    <span>命中策略的写操作会暂停，等待用户在对话中批准或拒绝。</span>
                  </div>
                  <input
                    type="checkbox"
                    role="switch"
                    className={styles.switch}
                    aria-label="启用工具人工审批"
                    checked={data.posture.fileWriteApproval === "ask"}
                    onChange={() => setEditing(true)}
                    title="由策略规则决定；点击编辑策略 JSON"
                  />
                </div>
                <div className={styles.head}>
                  <h2>需审批的工具</h2>
                  <span>高副作用或高风险工具默认命中 r-ask-write</span>
                </div>
                <div className={styles.permGrid}>
                  {askTools.length ? askTools.map((tool) => (
                    <span key={tool} className={`${styles.badge} ${styles.badgeNeutral}`}>
                      {tool}
                    </span>
                  )) : <span className={styles.muted}>当前策略没有 ask 规则。</span>}
                </div>
                <div className={`${styles.alert} ${styles.alertWarn}`}>
                  开启后 IM 侧需要发送 /approve 或 /reject；Dashboard 会弹出审批卡片。
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.head}>
                  <h2>工具与风险</h2>
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
              </section>

              <section className={styles.panel}>
                <div className={styles.head}>
                  <h2>
                    当前策略{data.policy.version ? ` v${data.policy.version}` : "（默认）"}
                  </h2>
                  <span>source={data.policy.source}</span>
                  <span className={styles.spacer} />
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
                  <Button size="sm" variant="secondary" loading={rollback.isPending}
                    onClick={doRollback}>
                    回滚
                  </Button>
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
                          <td>
                            <span className={`${styles.badge} ${effectTone(rule.effect)}`}>
                              {rule.effect}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}

          {sub === "files" ? (
            <section className={styles.panel}>
              <div className={styles.head}>
                <h2>文件访问</h2>
                <span>专家只能写入工作区，路径越界会被拒绝</span>
              </div>
              <div className={styles.infoGrid}>
                <div className={styles.infoCard}>
                  <span>工作区目录</span>
                  <code title={data.posture.workspaceDir}>{data.posture.workspaceDir}</code>
                </div>
                <div className={styles.infoCard}>
                  <span>工作区 jail</span>
                  <b>{data.posture.workspaceJail ? "工作区 jail 强制" : "未启用"}</b>
                </div>
                <div className={styles.infoCard}>
                  <span>文件写入审批</span>
                  <b>{data.posture.fileWriteApproval === "ask" ? "需要审批" : data.posture.fileWriteApproval}</b>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>文件工具</th><th>风险</th><th>所需 scope</th><th>审批</th></tr></thead>
                  <tbody>
                    {fsTools.map((tool) => (
                      <tr key={tool.toolKey}>
                        <td className={styles.mono}>{tool.toolKey}</td>
                        <td>{tool.risk}</td>
                        <td className={styles.mono}>{tool.requiredScope ?? "—"}</td>
                        <td>{tool.sideEffects ? "按策略" : "免审批"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.muted}>只读目录、路径白名单与按专家覆盖随 v1.1 支持在线配置。</p>
            </section>
          ) : null}

          {sub === "pii" ? (
            <section className={styles.panel}>
              <div className={styles.head}>
                <h2>敏感信息</h2>
                <span>发送前扫描与脱敏</span>
                <span className={`${styles.badge} ${styles.badgeNeutral}`}>
                  {data.posture.sensitiveInfoScan}
                </span>
              </div>
              <div className={styles.empty}>
                <span className={styles.emptyGlyph}>v1.1</span>
                <b>敏感信息扫描随 v1.1 接入</b>
                <p>计划在模型请求前检测密钥、证件号、手机号等模式，并支持脱敏或阻断；当前依赖工具审批与审计追溯。</p>
              </div>
            </section>
          ) : null}

          {sub === "command" ? (
            <section className={styles.panel}>
              <div className={styles.head}>
                <h2>命令防护</h2>
                <span>Shell 与进程执行限制</span>
                <span className={`${styles.badge} ${styles.badgeNeutral}`}>
                  {data.posture.commandGuard}
                </span>
              </div>
              {shellTools.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>命令工具</th><th>风险</th><th>副作用</th><th>全局开关</th></tr></thead>
                    <tbody>
                      {shellTools.map((tool) => (
                        <tr key={tool.toolKey}>
                          <td className={styles.mono}>{tool.toolKey}</td>
                          <td>{tool.risk}</td>
                          <td>{tool.sideEffects ? "是" : "否"}</td>
                          <td>{tool.enabledGlobal ? "启用" : "禁用"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`${styles.alert} ${styles.alertInfo}`}>当前实例没有启用 shell/命令类工具。</div>
              )}
              <p className={styles.muted}>命令白名单、超时与网络隔离随 v1.1 接入；当前以“无 shell 工具”作为默认防线。</p>
            </section>
          ) : null}

          {sub === "skill" ? (
            <section className={styles.panel}>
              <div className={styles.head}>
                <h2>技能扫描</h2>
                <span>安装前静态检查</span>
                <span className={`${styles.badge} ${styles.badgeNeutral}`}>
                  {data.posture.skillScan}
                </span>
              </div>
              <div className={styles.empty}>
                <span className={styles.emptyGlyph}>v1.1</span>
                <b>技能扫描随 v1.1 接入</b>
                <p>计划在技能包与插件安装前检查命令、网络与文件访问声明；当前依赖签名校验与人工审批。</p>
              </div>
            </section>
          ) : null}

          {sub === "audit" && canAudit ? (
            <AdminAuditTab onNotice={onNotice} onError={onError} />
          ) : null}
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
            <Button loading={publish.isPending} onClick={savePolicy} data-testid="policy-publish">
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
    </div>
  );
}
