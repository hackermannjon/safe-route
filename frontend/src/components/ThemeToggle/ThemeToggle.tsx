import { Icon } from '../Icon';
import styles from './ThemeToggle.module.css';

export interface ThemeToggleProps {
  theme: 'dark' | 'light';
  onToggle: () => void;
  className?: string;
}

/** Shows the theme it switches to, the way a light switch shows the other position. */
export function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={[styles.toggle, className].filter(Boolean).join(' ')}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={onToggle}
    >
      <span key={next} className={styles.icon}>
        <Icon name={next === 'light' ? 'sun' : 'moon'} />
      </span>
    </button>
  );
}
