import { Icon } from '../Icon';
import styles from './TripPill.module.css';

export interface TripPillProps {
  /** "Chicago → Denver"; null before both places are known. */
  route: string | null;
  placeholder?: string;
  onEdit: () => void;
  /** 'float' over the map (phones); 'inline' inside a panel. */
  variant?: 'float' | 'inline';
}

/** Reads as a summary of the trip and acts as the way back into the form. */
export function TripPill({ route, placeholder = 'Where are you headed?', onEdit, variant = 'float' }: TripPillProps) {
  return (
    <button
      type="button"
      className={styles.pill}
      data-variant={variant}
      onClick={onEdit}
      aria-label={route ? `Edit trip: ${route}` : placeholder}
    >
      <Icon name="search" size={20} className={styles.icon} />
      <span className={styles.text}>
        {route ? (
          <span className={styles.route}>{route}</span>
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
      </span>
      {route && <Icon name="edit" size={18} className={styles.edit} />}
    </button>
  );
}
