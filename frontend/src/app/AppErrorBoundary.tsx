import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../components/Button';
import styles from './AppErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Last line of defence: a render error should leave the driver a way back, not a blank screen. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.root} role="alert">
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.body}>Reload the page to start a new trip.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
