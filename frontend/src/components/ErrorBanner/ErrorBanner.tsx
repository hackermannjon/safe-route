import { useEffect, useRef } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './ErrorBanner.module.css';

export interface ErrorBannerProps {
  message: string;
  /** null leaves the title out, when a surrounding header already says it. */
  title?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  retrying?: boolean;
  /** Move focus here when shown, so the error is both announced and in view. */
  focusOnMount?: boolean;
}

export function ErrorBanner({
  message,
  title = "Couldn't plan this trip",
  onRetry,
  onDismiss,
  retrying,
  focusOnMount = false,
}: ErrorBannerProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusOnMount) rootRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div ref={rootRef} className={styles.root} role="alert" tabIndex={-1}>
      <Icon name="alert" size={20} className={styles.icon} />
      <div className={styles.text}>
        {title && <p className={styles.title}>{title}</p>}
        <p className={styles.message}>{message}</p>
        {(onRetry || onDismiss) && (
          <div className={styles.actions}>
            {onRetry && (
              <Button variant="secondary" onClick={onRetry} loading={retrying} loadingLabel="Retrying">
                <Icon name="retry" size={18} />
                Try again
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
