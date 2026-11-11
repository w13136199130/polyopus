import { PageShell } from "@/layouts/PageShell";
import styles from "./ComingSoonPage.module.css";

interface Props {
  title: string;
  milestone: string;
  note?: string;
}

/** Placeholder for pages outside v0.5 — the sidebar must not lie (docs/48 F2). */
export function ComingSoonPage({ title, milestone, note }: Props) {
  return (
    <PageShell title={title}>
      <div className={styles.box}>
        <span className={styles.badge}>{milestone}</span>
        <p className={styles.text}>
          {note ?? "此页面不在 v0.5 范围内，将在后续版本提供。"}
        </p>
      </div>
    </PageShell>
  );
}
