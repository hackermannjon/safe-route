import { formatEta, formatMilepost, formatRate, formatTemp, formatWind } from '../../lib/format';
import { factorLabel } from '../../lib/risk';
import { isNight } from '../../lib/daylight';
import { weatherCondition, weatherSky } from '../../lib/weatherCodes';
import type { Checkpoint, RiskFactor } from '../../types/api';
import { RiskBadge } from '../RiskBadge';
import { WeatherIcon, skyIcon, type WeatherIconName } from '../WeatherIcon';
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
  const sky = weatherSky(weather.weather_code);
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
        {condition && (
          <span className={styles.condition}>
            {sky && (
              <WeatherIcon
                name={skyIcon(sky, isNight(checkpoint.lat, checkpoint.lon, checkpoint.eta))}
                size={22}
                className={styles.sky}
              />
            )}
            {condition}
          </span>
        )}
      </p>

      <div className={styles.risk}>
        <RiskBadge level={checkpoint.level} />
        <span className={styles.factor}>Set by {factorLabel(checkpoint.factor).toLowerCase()}</span>
      </div>
      {checkpoint.load_rule && <p className={styles.rule}>Load rule: {checkpoint.load_rule}</p>}

      <dl className={styles.grid}>
        <Reading icon="wind" label="Wind" value={formatWind(weather.wind_mph)} main={driver === 'Wind'} />
        <Reading icon="gust" label="Gusts" value={formatWind(weather.gust_mph)} />
        <Reading icon="temp" label="Temp" value={formatTemp(weather.temp_f)} />
        <Reading icon="drop" label="Rain" value={formatRate(weather.rain_in_h)} main={driver === 'Rain'} />
        <Reading icon="flake" label="Snow" value={formatRate(weather.snow_in_h)} main={driver === 'Snow'} />
      </dl>
    </section>
  );
}

interface ReadingProps {
  icon: WeatherIconName;
  label: string;
  value: string;
  main?: boolean;
}

function Reading({ icon, label, value, main = false }: ReadingProps) {
  return (
    <div className={main ? `${styles.cell} ${styles.main}` : styles.cell}>
      <dt>
        <WeatherIcon name={icon} size={14} className={styles.readingIcon} />
        {label}
        {main && <span className={styles.srOnly}>, sets the level</span>}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
