import type { Ref } from 'react';
import type { HeatmapMetric } from '../../lib/heatmap';
import { Button } from '../../components/Button';
import { ForecastSlider } from '../../components/ForecastSlider';
import { HeatmapLegend } from '../../components/HeatmapLegend';
import { Icon } from '../../components/Icon';
import { SegmentedControl } from '../../components/SegmentedControl';
import { WeatherIcon, type WeatherIconName } from '../../components/WeatherIcon';
import { useForecastViewModel } from './useForecastViewModel';
import type { TripPlannerViewModel } from './useTripPlannerViewModel';
import styles from './ForecastPanel.module.css';

interface ForecastPanelProps {
  heatmap: TripPlannerViewModel['heatmap'];
  className?: string;
  ref?: Ref<HTMLElement>;
}

const METRIC_ICON: Record<HeatmapMetric, WeatherIconName> = { risk: 'risk', wind: 'wind', rain: 'drop', snow: 'flake' };

/**
 * The weather map's controls, docked on the map: the hour, the metric and its scale. The hour
 * comes from the scoped forecast ViewModel so a playback step re-renders this panel, not the screen.
 */
export function ForecastPanel({ heatmap, className, ref }: ForecastPanelProps) {
  const forecast = useForecastViewModel();
  return (
    <section
      ref={ref}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      aria-label="Forecast along the trip"
    >
      <ForecastSlider {...forecast.slider} />
      <div className={styles.row}>
        <SegmentedControl
          {...forecast.metric}
          options={forecast.metric.options.map((option) => ({
            ...option,
            icon: <WeatherIcon name={METRIC_ICON[option.value]} size={18} />,
          }))}
        />
        {heatmap.status === 'ready' && <HeatmapLegend metric={forecast.metric.value} className={styles.legend} />}
      </div>
      {heatmap.status === 'loading' && (
        <p className={styles.status} role="status">
          Loading the forecast around your routes…
        </p>
      )}
      {heatmap.status === 'error' && (
        <div className={styles.error} role="alert">
          <p>{heatmap.error}</p>
          <Button variant="secondary" onClick={heatmap.retry}>
            <Icon name="retry" size={18} />
            Try again
          </Button>
        </div>
      )}
    </section>
  );
}

interface WeatherToggleProps {
  heatmap: TripPlannerViewModel['heatmap'];
  className?: string;
}

export function WeatherToggle({ heatmap, className }: WeatherToggleProps) {
  return (
    <button
      type="button"
      className={[styles.toggle, className].filter(Boolean).join(' ')}
      aria-pressed={heatmap.status !== 'off'}
      onClick={heatmap.toggle}
    >
      <Icon name="layers" />
      Weather map
    </button>
  );
}
