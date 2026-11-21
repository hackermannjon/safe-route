import type { CSSProperties, KeyboardEvent } from 'react';
import type { DayMark, NightSpan } from '../../lib/forecastMarks';
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
  /** Where each new day starts, in hours after departure. */
  days?: readonly DayMark[];
  /** Hours after departure when it is dark where the truck is. */
  nights?: readonly NightSpan[];
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
/** Closer than this to another label, in hours, a day name is left off so labels never collide. */
const LABEL_GAP_H = 5;
const NO_DAYS: readonly DayMark[] = [];
const NO_NIGHTS: readonly NightSpan[] = [];

/** Along the track as the thumb's centre travels: half a thumb in from each end. */
const along = (hour: number, max: number) => ({ '--at': `${Math.min(1, Math.max(0, hour / max))}` }) as CSSProperties;

export function ForecastSlider({
  value,
  max,
  onChange,
  time,
  offset,
  days = NO_DAYS,
  nights = NO_NIGHTS,
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
  const arrivalAt = arrivalHour !== null && arrivalHour > 0 && arrivalHour <= max ? along(arrivalHour, max) : null;
  const named = days.filter((day) => day.at >= LABEL_GAP_H && max - day.at >= LABEL_GAP_H);

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
          {nights.map((night) => (
            <span
              key={night.from}
              className={styles.night}
              style={{ ...along(night.from, max), '--to': `${Math.min(1, night.to / max)}` } as CSSProperties}
              aria-hidden="true"
            />
          ))}
          {days.map((day) => (
            <span key={day.at} className={styles.midnight} style={along(day.at, max)} aria-hidden="true" />
          ))}
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
          <span className={styles.start}>Depart</span>
          {named.map((day) => (
            <span key={day.at} style={along(day.at, max)}>
              {day.label}
            </span>
          ))}
          <span className={styles.end}>{`+${max} h`}</span>
        </div>
      </div>
    </div>
  );
}
