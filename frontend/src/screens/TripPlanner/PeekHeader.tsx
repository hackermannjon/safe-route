import type { RouteListItem } from '../../components/RouteList';
import type { PlanStatus } from './useTripPlannerViewModel';
import styles from './PeekHeader.module.css';

interface PeekHeaderProps {
  status: PlanStatus;
  error: string | null;
  route: RouteListItem | null;
}

/** What the collapsed sheet shows: enough to decide without opening it. */
export function PeekHeader({ status, error, route }: PeekHeaderProps) {
  if (status === 'loading') {
    return (
      <div className={styles.peek}>
        <p className={styles.title}>
          <span className={styles.pulse} aria-hidden="true" />
          Planning your trip
        </p>
        <p className={styles.line}>Finding the fastest truck route.</p>
      </div>
    );
  }
  if (status === 'error' && error) {
    // The reason and the retry sit right under this, in the sheet.
    return (
      <div className={styles.peek}>
        <p className={styles.title}>Couldn't plan this trip</p>
      </div>
    );
  }
  if (!route) {
    return (
      <div className={styles.peek}>
        <p className={styles.title}>No route yet</p>
        <p className={styles.line}>Plan a trip to see its route.</p>
      </div>
    );
  }
  return (
    <div className={styles.peek}>
      <p className={styles.title}>{route.label}</p>
      <p className={styles.stats}>
        {route.distance} · {route.duration}
      </p>
    </div>
  );
}
