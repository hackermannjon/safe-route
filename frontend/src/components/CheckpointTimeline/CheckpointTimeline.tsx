import { memo, useEffect, useRef } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { RiskLevel } from '../../types/api';
import { RiskGlyph } from '../RiskGlyph';
import styles from './CheckpointTimeline.module.css';

export interface TimelineItem {
  index: number;
  /** "Start", "Mile 25", "Arrive". */
  place: string;
  /** Local clock time, e.g. "Sat 8:00 AM". */
  eta: string;
  /** Forecast at the ETA in a few words, e.g. "Light snow · Wind 12 mph · Snow 0.05 in/h · 31°F". */
  weather: string;
  level: RiskLevel;
  /** The level in words with what set it, e.g. "High · Rain". */
  risk: string;
  /** The cargo rule that raised the level, when one did. */
  loadRule?: string | null;
  kind: 'origin' | 'stop' | 'destination';
}

export interface CheckpointTimelineProps {
  items: readonly TimelineItem[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  label?: string;
}

/**
 * Checkpoints in driving order; pressing one shows it on the map. Memoised because a long trip
 * lists over a hundred rows and the forecast slider re-renders the screen on every hour.
 */
export const CheckpointTimeline = memo(function CheckpointTimeline({
  items,
  selectedIndex,
  onSelect,
  label = 'Checkpoints',
}: CheckpointTimelineProps) {
  const reducedMotion = useReducedMotion();
  const rows = useRef(new Map<number, HTMLButtonElement>());

  // The selection can come from the map; bring that row into view without moving keyboard focus.
  useEffect(() => {
    if (selectedIndex === null) return;
    rows.current.get(selectedIndex)?.scrollIntoView?.({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [selectedIndex, reducedMotion]);

  return (
    <ol className={styles.list} aria-label={label}>
      {items.map((item) => (
        <li key={item.index} className={styles.item} data-kind={item.kind}>
          <button
            ref={(el) => {
              if (el) rows.current.set(item.index, el);
              else rows.current.delete(item.index);
            }}
            type="button"
            className={styles.row}
            aria-pressed={item.index === selectedIndex}
            onClick={() => onSelect(item.index)}
          >
            <span className={styles.dot}>
              <RiskGlyph level={item.level} size={14} />
            </span>
            <span className={styles.place}>{item.place}</span>
            <span className={styles.eta}>{item.eta}</span>
            <span className={styles.risk} data-level={item.level}>
              {item.risk}
            </span>
            <span className={styles.weather}>{item.weather}</span>
            {item.loadRule && <span className={styles.rule}>Load rule: {item.loadRule}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
});
