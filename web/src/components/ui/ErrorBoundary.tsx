import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./states.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wrap-level boundary (mount under routes or feature roots). Radix handles
 * overlay focus; this one catches render crashes and offers a retry that
 * remounts the subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className={styles.stateBox} role="alert">
          <p className={`${styles.stateTitle} ${styles.stateTitleDanger}`}>页面出错了</p>
          <p className={styles.stateHint}>{String(this.state.error.message)}</p>
          {this.state.error.stack ? (
            <p className={styles.traceId}>
              <code>{this.state.error.stack.split("\n")[1]?.trim()}</code>
            </p>
          ) : null}
          <button
            type="button"
            className={styles.stateAction}
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
