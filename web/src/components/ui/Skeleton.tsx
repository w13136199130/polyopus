import styles from "./states.module.css";

export interface SkeletonProps {
  /** Number of text lines to suggest (default 3). */
  lines?: number;
}

/** Decorative placeholder — hidden from the a11y tree. */
export function Skeleton({ lines = 3 }: SkeletonProps) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={styles.skeletonLine}
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}
