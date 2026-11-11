import { PageShell } from "@/layouts/PageShell";
import styles from "./MigrationPage.module.css";

interface Props {
  title: string;
  card: string;
  note: string;
}

/**
 * v0.5 real pages land in V05-03..05; until then they point at the legacy
 * single-file UI (still served at /legacy) so nothing is actually lost.
 */
export function MigrationPage({ title, card, note }: Props) {
  return (
    <PageShell title={title}>
      <div className={styles.box}>
        <span className={styles.badge}>{card}</span>
        <p className={styles.text}>{note}</p>
        <a className={styles.link} href="/legacy">
          前往当前可用界面（/legacy）→
        </a>
      </div>
    </PageShell>
  );
}
