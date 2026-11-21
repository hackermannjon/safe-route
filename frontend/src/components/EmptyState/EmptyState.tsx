import type { ReactNode } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  body: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ title, body, actionLabel, onAction, compact = false }: EmptyStateProps) {
  return (
    <section className={styles.root} data-compact={compact || undefined} aria-label={title}>
      {!compact && (
        <span className={styles.badge} aria-hidden="true">
          <Icon name="truck" size={24} />
        </span>
      )}
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" onClick={onAction} className={styles.action}>
          {actionLabel}
        </Button>
      )}
    </section>
  );
}
