import type { ReactNode } from "react";
import styles from "./states.module.css";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: string;
}

export interface TableProps<T> {
  /** Accessible name of the table (rendered as <caption>). */
  caption: string;
  columns: Array<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Row-level test hook; keep stable to avoid churn. */
  rowClassName?: (row: T) => string;
}

export function Table<T>({ caption, columns, rows, rowKey, rowClassName }: TableProps<T>) {
  return (
    <table className={styles.table}>
      <caption className={styles.tableCaption}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className={rowClassName?.(row)}>
            {columns.map((column) => (
              <td key={column.key}>{column.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
