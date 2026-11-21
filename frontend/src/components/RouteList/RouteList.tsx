import styles from './RouteList.module.css';

export interface RouteListItem {
  id: string;
  label: string;
  distance: string;
  duration: string;
  /** Already phrased for display, e.g. "via I-80, I-76"; empty when unknown. */
  via: string;
}

export interface RouteListProps {
  routes: RouteListItem[];
}

/** A card per route: its distance, driving time and main roads. */
export function RouteList({ routes }: RouteListProps) {
  return (
    <ul className={styles.list} aria-label="Routes">
      {routes.map((route) => (
        <li key={route.id} className={styles.card}>
          <span className={styles.label}>{route.label}</span>
          <span className={styles.figures}>
            <span>{route.distance}</span>
            <span>{route.duration}</span>
          </span>
          {route.via && <span className={styles.via}>{route.via}</span>}
        </li>
      ))}
    </ul>
  );
}
