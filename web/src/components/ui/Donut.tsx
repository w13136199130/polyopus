import type { ReactNode } from "react";
import styles from "./Donut.module.css";

export interface DonutSegment {
  label: string;
  value: number;
  /** Any CSS color (usually a token like `var(--primary)`). */
  color: string;
}

export interface DonutProps {
  title: ReactNode;
  segments: readonly DonutSegment[];
  /** Center caption; defaults to the total. */
  centerLabel?: string;
  testId?: string;
}

const SIZE = 120;
const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/** Small SVG donut + legend; no chart dependency (docs/52 §6). */
export function Donut({ title, segments, centerLabel, testId }: DonutProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;

  return (
    <section className={styles.card} data-testid={testId}>
      <header className={styles.head}>
        <b>{title}</b>
      </header>
      <div className={styles.body}>
        <svg
          className={styles.donut}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={typeof title === "string" ? title : "分布"}
        >
          <circle
            className={styles.track}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
          />
          {total > 0
            ? segments.map((segment) => {
                const length = (segment.value / total) * CIRCUMFERENCE;
                const dash = `${length} ${CIRCUMFERENCE - length}`;
                const element = (
                  <circle
                    key={segment.label}
                    className={styles.segment}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    stroke={segment.color}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return element;
              })
            : null}
          <text className={styles.centerValue} x="60" y="56" textAnchor="middle">
            {formatValue(total)}
          </text>
          <text className={styles.centerLabel} x="60" y="72" textAnchor="middle">
            {centerLabel ?? "tokens"}
          </text>
        </svg>
        <ul className={styles.legend}>
          {segments.map((segment) => (
            <li key={segment.label}>
              <i style={{ background: segment.color }} aria-hidden="true" />
              <span className={styles.legendLabel}>{segment.label}</span>
              <span className={styles.legendValue}>{formatValue(segment.value)}</span>
              <span className={styles.legendPct}>
                {total > 0 ? `${Math.round((segment.value / total) * 100)}%` : "0%"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
