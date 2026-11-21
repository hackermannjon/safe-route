import type { CSSProperties, KeyboardEvent } from 'react';
import styles from './ForecastSlider.module.css';

export interface ForecastSliderProps {
  /** Hours after departure. */
  value: number;
  max: number;
  onChange: (hours: number) => void;
  /** "Sat 2:00 PM" */
  time: string;
  /** "+18 h" */
  offset: string;
  /** Where the truck is at that time, e.g. "Mile 420" or "Arrived". */
  status?: string;
  arrived?: boolean;
  /** What a screen reader announces for the current value. */
  valueText: string;
  playing: boolean;
  onTogglePlay: () => void;
  /** Hours after departure at which the truck arrives, marked on the track. */
  arrivalHour?: number | null;
  label?: string;
}

/** A quarter of a day per page key: the steps a driver thinks in (morning, afternoon, night). */
const PAGE_HOURS = 6;
const TICKS = [0, 12, 24, 36, 48];

export function ForecastSlider({
  value,
  max,
  onChange,
  time,
  offset,
  status,
  arrived = false,
  valueText,
  playing,
  onTogglePlay,
  arrivalHour = null,
  label = 'Forecast time',
}: ForecastSliderProps) {
  // Keys are handled here rather than left to the browser, which steps Page keys by a tenth of
  // the range and differs between engines.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const next = {
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      PageUp: value + PAGE_HOURS,
      PageDown: value - PAGE_HOURS,
      Home: 0,
      End: max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const clamped = Math.min(max, Math.max(0, next));
    if (clamped !== value) onChange(clamped);
  };

  const fill = { '--fill': `${(value / max) * 100}%` } as CSSProperties;
  const arrivalAt =
    arrivalHour !== null && arrivalHour > 0 && arrivalHour <= max
      ? ({ '--at': `${arrivalHour / max}` } as CSSProperties)
      : null;

  return (
    <div className={styles.slider}>
      <button
        type="button"
        className={styles.play}
        aria-label={playing ? 'Pause forecast' : 'Play forecast'}
        onClick={onTogglePlay}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          {playing ? <path d="M5 3h3.5v14H5zM11.5 3H15v14h-3.5z" /> : <path d="M6 3.2v13.6L16.5 10z" />}
        </svg>
      </button>
      <div className={styles.body}>
        <p className={styles.readout} aria-hidden="true">
          <span className={styles.time}>{time}</span>
          <span className={styles.offset}>{offset}</span>
          {status && (
            <span className={styles.status} data-arrived={arrived || undefined}>
              {status}
            </span>
          )}
        </p>
        <div className={styles.track}>
          <input
            type="range"
            className={styles.range}
            min={0}
            max={max}
            step={1}
            value={value}
            aria-label={label}
            aria-valuetext={valueText}
            style={fill}
            onChange={(event) => onChange(Number(event.currentTarget.value))}
            onKeyDown={onKeyDown}
          />
          {arrivalAt && <span className={styles.arrival} style={arrivalAt} title="Arrival" aria-hidden="true" />}
        </div>
        <div className={styles.ticks} aria-hidden="true">
          {TICKS.filter((tick) => tick <= max).map((tick) => (
            <span key={tick} style={{ '--at': `${tick / max}` } as CSSProperties}>
              {tick === 0 ? 'Depart' : `+${tick} h`}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
