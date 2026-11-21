import styles from './LoadingState.module.css';

export interface LoadingStateProps {
  message: string;
  detail?: string;
  /** Number of skeleton cards; match the expected result count to avoid a jump on arrival. */
  count?: number;
  /** Keep the message for screen readers only, when a surrounding header already shows it. */
  messageHidden?: boolean;
}

export function LoadingState({ message, detail, count = 3, messageHidden = false }: LoadingStateProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite" aria-busy="true">
      <div className={messageHidden ? 'visually-hidden' : styles.header}>
        <span className={styles.pulse} aria-hidden="true" />
        <div>
          <p className={styles.message}>{message}</p>
          {detail && <p className={styles.detail}>{detail}</p>}
        </div>
      </div>
      <ul className={styles.list} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className={styles.card}>
            <span className={`${styles.bone} ${styles.title}`} />
            <span className={`${styles.bone} ${styles.line}`} />
            <span className={styles.row}>
              <span className={`${styles.bone} ${styles.stat}`} />
              <span className={`${styles.bone} ${styles.stat}`} />
              <span className={`${styles.bone} ${styles.stat}`} />
            </span>
            <span className={`${styles.bone} ${styles.bar}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
