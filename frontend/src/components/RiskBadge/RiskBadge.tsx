import type { CSSProperties } from 'react';
import { RISK_META } from '../../lib/risk';
import type { RiskLevel } from '../../types/api';
import { RiskGlyph } from '../RiskGlyph';
import styles from './RiskBadge.module.css';

export interface RiskBadgeProps {
  level: RiskLevel;
  /** Labels the level as the route's highest, so a lone "Low" is not read as the whole picture. */
  peak?: boolean;
  className?: string;
}

export const PEAK_HINT = 'The highest weather risk anywhere on this route, at the hour the truck gets there';

/** Glyph and word on a quiet pill; the level colour is only a hint around it. */
export function RiskBadge({ level, peak = false, className }: RiskBadgeProps) {
  const meta = RISK_META[level];
  return (
    <span
      className={[styles.badge, className].filter(Boolean).join(' ')}
      style={{ '--badge-risk': meta.color } as CSSProperties}
      data-level={level}
      title={peak ? PEAK_HINT : undefined}
    >
      <RiskGlyph level={level} size={14} />
      {peak && <span className={styles.prefix}>Peak risk</span>}
      {meta.label}
    </span>
  );
}
