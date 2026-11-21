import type { RiskLevel } from '../../types/api';
import { RiskBadge } from '../RiskBadge';
import { RiskBar } from '../RiskBar';
import styles from './RouteList.module.css';

export interface RouteListItem {
  id: string;
  label: string;
  distance: string;
  duration: string;
  /** Already phrased for display, e.g. "Arrives Sat 11:40 PM". */
  arrival: string;
  /** Already phrased for display, e.g. "via I-80, I-76"; empty when unknown. */
  via: string;
  /** The worst level on the route and its miles at each level. */
  risk: { level: RiskLevel; miles: Record<RiskLevel, number> };
}

export interface RouteListProps {
  routes: RouteListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Route cards as toggle buttons; exactly one is pressed, the one drawn on top of the map. The
 * cards stay together, so every route is a short scroll away however long the selected one's
 * timeline is.
 */
export function RouteList({ routes, selectedId, onSelect }: RouteListProps) {
  return (
    <ul className={styles.list} aria-label="Routes">
      {routes.map((route) => {
        const selected = route.id === selectedId;
        return (
          <li key={route.id} className={styles.item}>
            <button
              type="button"
              className={selected ? `${styles.card} ${styles.selected}` : styles.card}
              aria-pressed={selected}
              onClick={() => onSelect(route.id)}
            >
              <span className={styles.head}>
                <span className={styles.label}>{route.label}</span>
                <RiskBadge level={route.risk.level} peak />
              </span>
              <span className={styles.figures}>
                <span>{route.distance}</span>
                <span>{route.duration}</span>
              </span>
              <span className={styles.arrival}>{route.arrival}</span>
              {route.via && <span className={styles.via}>{route.via}</span>}
              <RiskBar miles={route.risk.miles} className={styles.bar} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
