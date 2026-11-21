import type { CSSProperties } from 'react';
import { METRIC_META, RISK_FIELD_ALPHA, rampGradient, type HeatmapMetric } from '../../lib/heatmap';
import { RISK_LEVELS, RISK_META } from '../../lib/risk';
import styles from './HeatmapLegend.module.css';

export interface HeatmapLegendProps {
  metric: HeatmapMetric;
  className?: string;
}

export function HeatmapLegend({ metric, className }: HeatmapLegendProps) {
  const classes = [styles.legend, className].filter(Boolean).join(' ');
  if (metric === 'risk') {
    return (
      <ul className={`${classes} ${styles.levels}`} role="list" aria-label="Heatmap risk levels">
        {RISK_LEVELS.map((level) => (
          <li key={level} className={styles.level}>
            <span
              className={styles.swatch}
              style={{ background: RISK_META[level].color, opacity: RISK_FIELD_ALPHA[RISK_META[level].order] + 0.2 }}
              aria-hidden="true"
            />
            {RISK_META[level].label}
          </li>
        ))}
      </ul>
    );
  }
  const meta = METRIC_META[metric];
  const end = meta.ticks[meta.ticks.length - 1];
  return (
    <figure className={`${classes} ${styles.scale}`} aria-label={`${meta.label} scale, ${meta.unit}`}>
      <div className={styles.bar} style={{ background: rampGradient(meta) }} />
      <div className={styles.ticks} aria-hidden="true">
        {meta.ticks.map((tick) => (
          <span key={tick} style={{ '--at': `${tick / end}` } as CSSProperties}>
            {tick}
          </span>
        ))}
        <span className={styles.unit}>{meta.unit}</span>
      </div>
    </figure>
  );
}
