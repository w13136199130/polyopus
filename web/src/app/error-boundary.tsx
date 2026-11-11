import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./error-boundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Route-level boundary: keep the shell alive, show a retry (docs/49 §9). */
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
        <div className={styles.wrap} role="alert">
          <p className={styles.title}>页面出错了</p>
          <p className={styles.detail}>{String(this.state.error.message)}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
