import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Dialog, Drawer, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import type { AgentRow, TeamRow } from "@/lib/api/wire";
import { useCreateTeam, useRunTeam, useStopTeam, useTeams } from "@/features/teams/api";
import styles from "./TeamPanel.module.css";

function dateOf(ts: number): string {
  const date = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function TeamCard({
  team,
  canWrite,
  onRun,
  onStop,
}: {
  team: TeamRow;
  canWrite: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  return (
    <article className={styles.card} data-testid="team-row">
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <h2 className={styles.name}>{team.name}</h2>
          <span className={styles.count}>{team.memberCount} 名成员</span>
        </div>
        <span className={styles.updated}>{dateOf(team.updatedAt)}</span>
      </header>
      <p className={styles.desc}>{team.description || "无描述"}</p>
      {team.members.length === 0 ? (
        <span className={styles.noMembers}>暂无成员</span>
      ) : (
        <div className={styles.members}>
          {team.members.map((member) => (
            <span key={member.agentId} className={styles.member}>
              {member.role === "lead" ? <i className={styles.lead}>协调者</i> : null}
              {member.name}
              <em className={styles.memberState}>
                {member.status === "published" ? `v${member.version}` : "草稿"}
              </em>
            </span>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <Button
          size="sm"
          data-testid="team-run"
          disabled={!canWrite || team.memberCount === 0}
          title={team.memberCount === 0 ? "先给团队添加成员" : undefined}
          onClick={onRun}
        >
          派工运行
        </Button>
        <Button size="sm" variant="ghost" disabled={!canWrite} onClick={onStop}>
          停止
        </Button>
      </div>
    </article>
  );
}

/** Team roster + create/run/stop (v1.1 orchestration slice 2). */
export function TeamPanel({ agents }: { agents: readonly AgentRow[] }) {
  const query = useTeams();
  const navigate = useNavigate();
  const canWrite = useCan("team:write");
  const createTeam = useCreateTeam();
  const runTeam = useRunTeam();
  const stopTeam = useStopTeam();

  const [createOpen, setCreateOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<TeamRow | null>(null);
  const [stopTarget, setStopTarget] = useState<TeamRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const published = agents.filter((agent) => agent.status === "published");
  const items = query.data?.items ?? [];

  return (
    <div data-testid="teams-page" className={styles.wrap}>
      {notice ? <div className={styles.notice} onClick={() => setNotice(null)}>{notice}</div> : null}
      {error ? <div className={styles.error} onClick={() => setError(null)}>{error}</div> : null}

      <div className={styles.toolbar}>
        <span className={styles.toolbarCount}>共 {items.length} 个团队</span>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()} loading={query.isFetching}>
          刷新
        </Button>
        <Button
          size="sm"
          data-testid="team-new"
          disabled={!canWrite}
          onClick={() => {
            setError(null);
            setCreateOpen(true);
          }}
        >
          ＋ 新建团队
        </Button>
      </div>

      {query.isLoading ? (
        <Loading label="载入团队…" />
      ) : query.isError ? (
        <ErrorState message="团队加载失败" onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          title="还没有团队"
          hint="创建一个团队并选入已发布专家，协调者会按成员拆分任务。"
          action={canWrite ? { label: "新建团队", onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <div className={styles.grid}>
          {items.map((team) => (
            <TeamCard
              key={team.teamId}
              team={team}
              canWrite={canWrite}
              onRun={() => {
                setError(null);
                setRunTarget(team);
              }}
              onStop={() => setStopTarget(team)}
            />
          ))}
        </div>
      )}

      <CreateTeamDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={published}
        canWrite={canWrite}
        pending={createTeam.isPending}
        onCreate={async (body) => {
          const team = await createTeam.mutateAsync(body);
          setNotice(`已创建团队 ${team.name}`);
        }}
        onError={setError}
      />

      <RunTeamDrawer
        team={runTarget}
        onClose={() => setRunTarget(null)}
        canWrite={canWrite}
        pending={runTeam.isPending}
        onRun={async (task, memberIds) => {
          if (!runTarget) return;
          const result = await runTeam.mutateAsync({ teamId: runTarget.teamId, task, memberIds });
          setRunTarget(null);
          setNotice(`已派工 ${result.delegations.length} 名成员`);
          navigate(`/chat/${encodeURIComponent(result.roomThreadId)}`);
        }}
        onError={setError}
      />

      <Dialog
        open={stopTarget !== null}
        onOpenChange={(open) => { if (!open) setStopTarget(null); }}
        title="停止团队运行"
        description={stopTarget ? `将停止「${stopTarget.name}」当前房间内的运行。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStopTarget(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="team-stop-confirm"
              loading={stopTeam.isPending}
              onClick={() => {
                if (!stopTarget) return;
                stopTeam.mutate(stopTarget.teamId, {
                  onSuccess: () => setNotice(`已停止 ${stopTarget.name}`),
                  onError: (err) => setError(err instanceof Error ? err.message : "停止失败"),
                  onSettled: () => setStopTarget(null),
                });
              }}
            >
              确认停止
            </Button>
          </>
        }
      >
        <p className={styles.stopNote}>正在执行的成员派工会收到停止请求；已产生的任务保留。</p>
      </Dialog>
    </div>
  );
}

function CreateTeamDrawer({
  open,
  onOpenChange,
  agents,
  canWrite,
  pending,
  onCreate,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: readonly AgentRow[];
  canWrite: boolean;
  pending: boolean;
  onCreate: (body: {
    name: string; description?: string; leadId?: string; memberIds?: string[];
  }) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  function reset() {
    setName("");
    setDescription("");
    setLeadId("");
    setMemberIds(new Set());
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}
      title="新建团队"
      description="协调者负责拆分任务；成员需为已发布专家。"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="submit"
            form="team-create-form"
            data-testid="team-create"
            loading={pending}
            disabled={!canWrite || !name.trim()}
          >
            创建团队
          </Button>
        </>
      }
    >
      <form
        id="team-create-form"
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void onCreate({
            name: name.trim(),
            description: description.trim() || undefined,
            leadId: leadId || undefined,
            memberIds: [...memberIds],
          }).then(() => {
            reset();
            onOpenChange(false);
          }).catch((err: unknown) => {
            onError(err instanceof Error ? err.message : "创建团队失败");
          });
        }}
      >
        <label className={styles.field}>
          <span>团队名称 *</span>
          <input data-testid="team-name" required maxLength={100} value={name}
            onChange={(event) => setName(event.target.value)} placeholder="例如：发布保障组" />
        </label>
        <label className={styles.field}>
          <span>描述</span>
          <textarea rows={2} value={description}
            onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>协调者</span>
          <select data-testid="team-lead" value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            <option value="">（暂不指定）</option>
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
            ))}
          </select>
        </label>
        <div className={styles.field}>
          <span>成员</span>
          <div className={styles.memberPick}>
            {agents.length === 0 ? <em>还没有已发布专家</em> : null}
            {agents.map((agent) => (
              <label key={agent.agentId} className={styles.check} data-testid="team-member-option">
                <input
                  type="checkbox"
                  checked={memberIds.has(agent.agentId)}
                  onChange={(event) =>
                    setMemberIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(agent.agentId);
                      else next.delete(agent.agentId);
                      return next;
                    })}
                />
                {agent.name}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Drawer>
  );
}

function RunTeamDrawer({
  team,
  onClose,
  canWrite,
  pending,
  onRun,
  onError,
}: {
  team: TeamRow | null;
  onClose: () => void;
  canWrite: boolean;
  pending: boolean;
  onRun: (task: string, memberIds: string[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setTask("");
    setSelected(new Set());
  }, [team?.teamId]);

  const workers = (team?.members ?? []).filter((member) => member.role === "member");

  return (
    <Drawer
      open={team !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="派工运行"
      description={team?.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            type="submit"
            form="team-run-form"
            data-testid="team-run-submit"
            loading={pending}
            disabled={!canWrite || !task.trim() || (selected.size === 0 && workers.length === 0)}
          >
            开始运行
          </Button>
        </>
      }
    >
      <form
        id="team-run-form"
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(
            task.trim(),
            selected.size ? [...selected] : workers.map((member) => member.agentId),
          ).catch((err: unknown) => {
            onError(err instanceof Error ? err.message : "派工失败");
          });
        }}
      >
        <label className={styles.field}>
          <span>任务内容 *</span>
          <textarea
            data-testid="team-run-task"
            rows={4}
            required
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="例如：检查本周发布说明，分别核对变更、风险和回滚步骤。"
          />
        </label>
        <div className={styles.field}>
          <span>参与成员（不选则全部成员）</span>
          <div className={styles.memberPick}>
            {workers.length === 0 ? <em>团队还没有普通成员，请先补充成员。</em> : null}
            {workers.map((member) => (
              <label key={member.agentId} className={styles.check}>
                <input
                  type="checkbox"
                  checked={selected.has(member.agentId)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(member.agentId);
                      else next.delete(member.agentId);
                      return next;
                    })}
                />
                {member.name}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Drawer>
  );
}
