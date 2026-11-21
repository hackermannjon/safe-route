import { RISK_LEVELS, RISK_META } from '../../lib/risk';
import { RiskGlyph } from '../RiskGlyph';
import styles from './RiskLegend.module.css';

export interface RiskLegendProps {
  /** One tight row, for overlaying the map. */
  compact?: boolean;
  className?: string;
}

export function RiskLegend({ compact = false, className }: RiskLegendProps) {
  const classes = [styles.legend, compact ? styles.compact : styles.full, className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <span className={styles.title}>Weather risk</span>
      <ul className={styles.levels} role="list" aria-label="Risk levels">
        {RISK_LEVELS.map((level) => (
          <li key={level} className={styles.item}>
            {/* Below 14px the octagon and the circle become the same blob. */}
            <RiskGlyph level={level} size={compact ? 14 : 16} />
            <span>{RISK_META[level].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
