import { Empty, ErrorState, Loading } from "@/components/ui";
import { useTeams } from "@/features/teams/api";
import type { TeamRow } from "@/lib/api/wire";
import styles from "./TeamPanel.module.css";

function dateOf(ts: number): string {
  const date = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function TeamCard({ team }: { team: TeamRow }) {
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
    </article>
  );
}

/**
 * Roster panel shared by 专家 → 我的团队 (tab) and the legacy /teams route.
 * Create/edit/delegation stay honest placeholders until the next slice.
 */
export function TeamPanel() {
  const query = useTeams();
  const items = query.data?.items ?? [];

  return (
    <div data-testid="teams-page" className={styles.wrap}>
      {query.isLoading ? (
        <Loading label="载入团队…" />
      ) : query.isError ? (
        <ErrorState message="团队加载失败" onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          title="还没有团队"
          hint="团队会在这里展示协调者与成员；创建入口随下一批开放。"
        />
      ) : (
        <div className={styles.grid}>
          {items.map((team) => (
            <TeamCard key={team.teamId} team={team} />
          ))}
        </div>
      )}
    </div>
  );
}
