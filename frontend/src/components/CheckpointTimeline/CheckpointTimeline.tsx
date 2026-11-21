import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import styles from './CheckpointTimeline.module.css';

export interface TimelineItem {
  index: number;
  /** "Start", "Mile 25", "Arrive". */
  place: string;
  /** Local clock time, e.g. "Sat 8:00 AM". */
  eta: string;
  kind: 'origin' | 'stop' | 'destination';
}

export interface CheckpointTimelineProps {
  items: readonly TimelineItem[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  label?: string;
}

/** Checkpoints in driving order; pressing one shows it on the map. */
export function CheckpointTimeline({ items, selectedIndex, onSelect, label = 'Checkpoints' }: CheckpointTimelineProps) {
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
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.place}>{item.place}</span>
            <span className={styles.eta}>{item.eta}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
