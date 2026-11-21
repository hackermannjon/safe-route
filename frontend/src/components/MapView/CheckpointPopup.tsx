import { formatEta, formatMilepost, formatRate, formatTemp, formatWind } from '../../lib/format';
import { factorLabel } from '../../lib/risk';
import { weatherCondition } from '../../lib/weatherCodes';
import type { Checkpoint, RiskFactor } from '../../types/api';
import { RiskBadge } from '../RiskBadge';
import styles from './CheckpointPopup.module.css';

export interface CheckpointPopupProps {
  checkpoint: Checkpoint;
  routeLabel: string;
  onClose?: () => void;
}

type ReadingName = 'Wind' | 'Rain' | 'Snow';

/** A load rule is still about wind: it is the wind reading the driver should look at. */
const DRIVING_READING: Record<RiskFactor, ReadingName> = { wind: 'Wind', load: 'Wind', rain: 'Rain', snow: 'Snow' };

/** Everything known about one checkpoint: where, when the truck is there, and the forecast then. */
export function CheckpointPopup({ checkpoint, routeLabel, onClose }: CheckpointPopupProps) {
  const { weather } = checkpoint;
  const condition = weatherCondition(weather.weather_code);
  const driver = DRIVING_READING[checkpoint.factor];
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

      <div className={styles.risk}>
        <RiskBadge level={checkpoint.level} />
        <span className={styles.factor}>Set by {factorLabel(checkpoint.factor).toLowerCase()}</span>
      </div>
      {checkpoint.load_rule && <p className={styles.rule}>Load rule: {checkpoint.load_rule}</p>}

      <dl className={styles.grid}>
        <Reading label="Wind" value={formatWind(weather.wind_mph)} main={driver === 'Wind'} />
        <Reading label="Gusts" value={formatWind(weather.gust_mph)} />
        <Reading label="Temp" value={formatTemp(weather.temp_f)} />
        <Reading label="Rain" value={formatRate(weather.rain_in_h)} main={driver === 'Rain'} />
        <Reading label="Snow" value={formatRate(weather.snow_in_h)} main={driver === 'Snow'} />
      </dl>
    </section>
  );
}

function Reading({ label, value, main = false }: { label: string; value: string; main?: boolean }) {
  return (
    <div className={main ? `${styles.cell} ${styles.main}` : styles.cell}>
      <dt>
        {label}
        {main && <span className={styles.srOnly}>, sets the level</span>}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
