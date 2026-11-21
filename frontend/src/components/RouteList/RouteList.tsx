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
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Route cards as toggle buttons; exactly one is pressed, the one drawn on top of the map. */
export function RouteList({ routes, selectedId, onSelect }: RouteListProps) {
  return (
    <ul className={styles.list} aria-label="Routes">
      {routes.map((route) => {
        const selected = route.id === selectedId;
        return (
          <li key={route.id}>
            <button
              type="button"
              className={selected ? `${styles.card} ${styles.selected}` : styles.card}
              aria-pressed={selected}
              onClick={() => onSelect(route.id)}
            >
              <span className={styles.label}>{route.label}</span>
              <span className={styles.figures}>
                <span>{route.distance}</span>
                <span>{route.duration}</span>
              </span>
              {route.via && <span className={styles.via}>{route.via}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
