import type { CSSProperties } from 'react';
import { formatMiles } from '../../lib/format';
import { RISK_LEVELS, RISK_META } from '../../lib/risk';
import type { RiskLevel } from '../../types/api';
import styles from './RiskBar.module.css';

export interface RiskBarProps {
  miles: Record<RiskLevel, number>;
  className?: string;
}

/** Share of a route's miles at each level, worst on the right. A span, because it sits inside a button. */
export function RiskBar({ miles, className }: RiskBarProps) {
  const parts = RISK_LEVELS.filter((level) => (miles[level] ?? 0) > 0).map((level) => ({
    level,
    miles: miles[level],
    meta: RISK_META[level],
  }));
  const summary = parts.length
    ? parts.map((p) => `${p.meta.label} ${formatMiles(p.miles)}`).join(', ')
    : 'No risk data';

  return (
    <span
      className={[styles.bar, className].filter(Boolean).join(' ')}
      role="img"
      aria-label={`Miles by risk: ${summary}`}
    >
      {parts.map((p) => (
        <span
          key={p.level}
          className={styles.part}
          // flex-grow by miles keeps proportions; the CSS min-width keeps a short
          // Severe stretch from vanishing next to 900 Low miles.
          style={{ flexGrow: p.miles, background: p.meta.color } as CSSProperties}
          title={`${p.meta.label}: ${formatMiles(p.miles)}`}
          data-level={p.level}
        />
      ))}
    </span>
  );
}
