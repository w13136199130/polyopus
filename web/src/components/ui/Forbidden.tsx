import styles from "./states.module.css";

export interface ForbiddenProps {
  hint?: string;
}

/** 403 never leaks whether the resource exists (docs/28 AUTH-007). */
export function Forbidden({ hint }: ForbiddenProps) {
  return (
    <div className={styles.stateBox} role="alert">
      <p className={styles.stateTitle}>没有权限</p>
      <p className={styles.stateHint}>{hint ?? "你没有访问此页面的权限。如需申请，请联系管理员。"}</p>
    </div>
  );
}
