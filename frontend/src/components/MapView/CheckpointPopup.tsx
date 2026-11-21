import { formatEta, formatMilepost, formatRate, formatTemp, formatWind } from '../../lib/format';
import { weatherCondition } from '../../lib/weatherCodes';
import type { Checkpoint } from '../../types/api';
import styles from './CheckpointPopup.module.css';

export interface CheckpointPopupProps {
  checkpoint: Checkpoint;
  routeLabel: string;
  onClose?: () => void;
}

/** Everything known about one checkpoint: where, when the truck is there, and the forecast then. */
export function CheckpointPopup({ checkpoint, routeLabel, onClose }: CheckpointPopupProps) {
  const { weather } = checkpoint;
  const condition = weatherCondition(weather.weather_code);
  return (
    <section className={styles.card} aria-label={`${formatMilepost(checkpoint.mile)} details`}>
      <div className={styles.head}>
        <p className={styles.title}>
          {formatMilepost(checkpoint.mile)}
          <span className={styles.eta}>{formatEta(checkpoint.eta)}</span>
        </p>
        {onClose && (
          <button type="button" className={styles.close} aria-label="Close checkpoint details" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <p className={styles.sub}>
        <span>{routeLabel}</span>
        {condition && <span className={styles.condition}>{condition}</span>}
      </p>

      <dl className={styles.grid}>
        <Reading label="Wind" value={formatWind(weather.wind_mph)} />
        <Reading label="Gusts" value={formatWind(weather.gust_mph)} />
        <Reading label="Temp" value={formatTemp(weather.temp_f)} />
        <Reading label="Rain" value={formatRate(weather.rain_in_h)} />
        <Reading label="Snow" value={formatRate(weather.snow_in_h)} />
      </dl>
    </section>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.cell}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
