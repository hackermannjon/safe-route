import { useMemo } from 'react';
import { dayMarks, nightSpans } from '../../lib/forecastMarks';
import { formatEta, formatMilepost } from '../../lib/format';
import { HEATMAP_METRICS, MAX_FORECAST_HOUR, METRIC_LABEL } from '../../lib/heatmap';
import { buildTrack, truckAt, type TruckPosition } from '../../lib/truck';
import {
  selectHeatmapData,
  selectHeatmapOn,
  selectHour,
  selectMetric,
  selectPlan,
  selectPlaying,
  selectSelectedRouteId,
  useTripStore,
} from '../../stores';

const HOUR_MS = 3_600_000;
const METRIC_OPTIONS = HEATMAP_METRICS.map((value) => ({ value, label: METRIC_LABEL[value] }));

/** "Sat 2:00 PM, 18 hours after departure. Truck near mile 1,020." */
function forecastValueText(time: string, hour: number, truck: TruckPosition | null): string {
  const after = hour === 0 ? 'at departure' : `${hour} ${hour === 1 ? 'hour' : 'hours'} after departure`;
  const where = !truck
    ? ''
    : truck.arrived
      ? ' Truck has arrived.'
      : ` Truck near ${formatMilepost(truck.mile).toLowerCase()}.`;
  return `${time}, ${after}.${where}`;
}

const { setHour, setPlaying, setMetric } = useTripStore.getState();

/**
 * A scoped ViewModel beside the screen's main one, for the only region that changes many times a
 * second: the forecast slider and the map's hour and truck. Only what subscribes through here
 * re-renders on each playback step; the form, the route list and the timeline do not.
 */
export function useForecastViewModel() {
  const plan = useTripStore(selectPlan);
  const selectedRouteId = useTripStore(selectSelectedRouteId);
  const heatmapOn = useTripStore(selectHeatmapOn);
  const heatmapData = useTripStore(selectHeatmapData);
  const metric = useTripStore(selectMetric);
  const hour = useTripStore(selectHour);
  const playing = useTripStore(selectPlaying);

  const selectedRoute = useMemo(
    () => plan?.routes.find((route) => route.id === selectedRouteId) ?? null,
    [plan, selectedRouteId],
  );
  const track = useMemo(() => (selectedRoute ? buildTrack(selectedRoute) : null), [selectedRoute]);
  const departMs = plan ? Date.parse(plan.departure) : NaN;
  const atMs = departMs + hour * HOUR_MS;
  const truck = useMemo(() => (heatmapOn && track ? truckAt(track, atMs) : null), [heatmapOn, track, atMs]);
  const forecastTime = Number.isFinite(atMs) ? formatEta(new Date(atMs).toISOString()) : '—';
  const arrivalHour = track && Number.isFinite(departMs) ? (track.arriveMs - departMs) / HOUR_MS : null;
  const departure = plan?.departure ?? '';
  const days = useMemo(() => dayMarks(Date.parse(departure), MAX_FORECAST_HOUR), [departure]);
  // Dark where the truck is at each time, so the bands match what the driver will see.
  const nights = useMemo(
    () =>
      track
        ? nightSpans(Date.parse(departure), MAX_FORECAST_HOUR, (ms) => {
            const at = truckAt(track, ms);
            return [at.lat, at.lon];
          })
        : [],
    [track, departure],
  );
  const mapHeatmap = useMemo(
    () => (heatmapOn && heatmapData ? { data: heatmapData, hour, metric, playing } : null),
    [heatmapOn, heatmapData, hour, metric, playing],
  );

  return {
    metric: {
      label: 'Show',
      value: metric,
      options: METRIC_OPTIONS,
      onChange: setMetric,
    },
    slider: {
      value: hour,
      max: MAX_FORECAST_HOUR,
      onChange: setHour,
      time: forecastTime,
      offset: `+${hour} h`,
      days,
      nights,
      status: truck ? (truck.arrived ? 'Arrived' : formatMilepost(truck.mile)) : undefined,
      arrived: truck?.arrived ?? false,
      valueText: forecastValueText(forecastTime, hour, truck),
      playing,
      onTogglePlay: () => setPlaying(!playing),
      arrivalHour,
    },
    /** For the map: the field to draw, or null while off or loading. */
    mapHeatmap,
    /** Where the selected route's truck is at the slider's time, while the weather map is on. */
    truck,
  };
}

export type ForecastViewModel = ReturnType<typeof useForecastViewModel>;
