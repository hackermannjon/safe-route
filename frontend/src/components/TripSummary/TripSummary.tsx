import type { RiskLevel } from '../../types/api';
import { RiskBadge } from '../RiskBadge';
import styles from './TripSummary.module.css';

export interface TripSummaryProps {
  /** The recommended route's name, e.g. "Route B". */
  route: string;
  distance: string;
  duration: string;
  /** Already phrased for display, e.g. "Arrives Sat 11:40 PM". */
  arrival: string;
  /** The highest level on that route. */
  level: RiskLevel;
  className?: string;
}

/** The recommended route in one line of figures, so the answer reads before the details. */
export function TripSummary({ route, distance, duration, arrival, level, className }: TripSummaryProps) {
  return (
    <section className={[styles.summary, className].filter(Boolean).join(' ')} aria-label="Recommended route">
      <div className={styles.head}>
        <p className={styles.title}>
          <span className={styles.eyebrow}>Recommended</span>
          <span className={styles.route}>{route}</span>
        </p>
        <RiskBadge level={level} peak />
      </div>
      <p className={styles.figures}>
        <span>{distance}</span>
        <span>{duration}</span>
        <span className={styles.arrival}>{arrival}</span>
      </p>
    </section>
  );
}
