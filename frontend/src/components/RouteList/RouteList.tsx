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
  recommended: boolean;
  /** Why the route ranks where it does, e.g. "12 more miles in High risk than Route B." */
  reason: string;
}

export interface RouteListProps {
  routes: RouteListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Route cards as toggle buttons, in the order given; exactly one is pressed, the one drawn on top
 * of the map. The recommended card keeps its mark whichever card is pressed. The cards stay
 * together, so every route is a short scroll away however long the selected one's timeline is.
 */
export function RouteList({ routes, selectedId, onSelect }: RouteListProps) {
  return (
    <ul className={styles.list} aria-label="Routes">
      {routes.map((route) => {
        const selected = route.id === selectedId;
        const className = [styles.card, route.recommended && styles.recommended, selected && styles.selected]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={route.id} className={styles.item}>
            <button type="button" className={className} aria-pressed={selected} onClick={() => onSelect(route.id)}>
              <span className={styles.head}>
                <span className={styles.name}>
                  <span className={styles.label}>{route.label}</span>
                  {route.recommended && <span className={styles.tag}>Recommended</span>}
                </span>
                <RiskBadge level={route.risk.level} peak />
              </span>
              <span className={styles.figures}>
                <span>{route.distance}</span>
                <span>{route.duration}</span>
              </span>
              <span className={styles.arrival}>{route.arrival}</span>
              {route.via && <span className={styles.via}>{route.via}</span>}
              <RiskBar miles={route.risk.miles} className={styles.bar} />
              {route.reason && <span className={styles.reason}>{route.reason}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
