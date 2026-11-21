import { describe, expect, it } from 'vitest';
import { MAX_FORECAST_HOUR, type HeatmapData } from '../../lib/heatmap';
import type { Checkpoint, PlanResponse, Route } from '../../types/api';
import { recommendedRoute, selectHour, selectPlan, useTripStore } from '../useTripStore';

const checkpoint = (index: number): Checkpoint => ({
  index,
  mile: index * 25,
  lat: 41,
  lon: -87 - index,
  eta: '2026-11-21T14:00:00Z',
  level: 'LOW',
  factor: 'wind',
  load_rule: null,
  weather: { wind_mph: 10, gust_mph: 15, rain_in_h: 0, snow_in_h: 0, temp_f: 40, weather_code: 0 },
});

const route = (id: string, rank: number, checkpoints = 3): Route => ({
  id,
  label: `Route ${id}`,
  rank,
  recommended: rank === 1,
  rank_reason: '',
  via: [],
  distance_mi: 50,
  duration_s: 3600,
  arrival: '2026-11-21T15:00:00Z',
  checkpoints: Array.from({ length: checkpoints }, (_, i) => checkpoint(i)),
  risk: { worst_level: 'LOW', avg_risk: 0, miles: { LOW: 50, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: 0 } },
  geometry: { type: 'LineString', coordinates: [] },
  segments: { type: 'FeatureCollection', features: [] },
});

const PLAN: PlanResponse = {
  departure: '2026-11-21T14:00:00Z',
  cargo_lb: 20_000,
  spacing_mi: 25,
  recommended_route_id: 'B',
  notices: [],
  routes: [route('A', 2), route('B', 1, 2)],
};

const FIELD = { hours: [] } as unknown as HeatmapData;
const store = () => useTripStore.getState();

describe('useTripStore', () => {
  it('selects the recommended route when a plan arrives', () => {
    store().setPlan(PLAN);
    expect(selectPlan(store())).toBe(PLAN);
    expect(store().selectedRouteId).toBe('B');
    expect(store().selectedCheckpoint).toBeNull();
  });

  it('falls back to the best rank when the recommended id is unknown', () => {
    expect(recommendedRoute({ ...PLAN, recommended_route_id: 'Z' })?.id).toBe('B');
    expect(recommendedRoute({ ...PLAN, routes: [] })).toBeNull();
  });

  it('only selects routes and checkpoints that exist on the plan', () => {
    store().setPlan(PLAN);
    store().selectRoute('Z');
    expect(store().selectedRouteId).toBe('B');

    store().selectCheckpoint(2); // Route B has checkpoints 0 and 1 only.
    expect(store().selectedCheckpoint).toBeNull();
    store().selectCheckpoint(1);
    expect(store().selectedCheckpoint).toBe(1);
  });

  it('forgets the checkpoint when another route is selected', () => {
    store().setPlan(PLAN);
    store().selectCheckpoint(1);
    store().selectRoute('A');
    expect(store().selectedRouteId).toBe('A');
    expect(store().selectedCheckpoint).toBeNull();
  });

  it('clears the selection with the plan', () => {
    store().setPlan(PLAN);
    store().clearPlan();
    expect(store().plan).toBeNull();
    expect(store().selectedRouteId).toBeNull();
  });

  it('tracks the weather map request', () => {
    store().heatmapRequested();
    expect(store().heatmapLoading).toBe(true);
    store().heatmapFailed('Weather map is unavailable.');
    expect(store()).toMatchObject({ heatmapLoading: false, heatmapError: 'Weather map is unavailable.' });
    store().heatmapRequested();
    store().heatmapLoaded(FIELD);
    expect(store()).toMatchObject({ heatmapData: FIELD, heatmapLoading: false, heatmapError: null });
  });

  it('keeps the on/off choice but drops the field and rewinds on reset', () => {
    store().setHeatmapOn(true);
    store().heatmapLoaded(FIELD);
    store().setHour(12);
    store().resetHeatmap();
    expect(store()).toMatchObject({ heatmapOn: true, heatmapData: null, hour: 0, playing: false });
  });

  it('stops playback when the map is hidden', () => {
    store().setHeatmapOn(true);
    store().setPlaying(true);
    store().setHeatmapOn(false);
    expect(store().playing).toBe(false);
  });

  it('clamps and rounds hand-picked hours, stopping playback', () => {
    store().setPlaying(true);
    store().setHour(7.6);
    expect(selectHour(store())).toBe(8);
    expect(store().playing).toBe(false);
    store().setHour(99);
    expect(store().hour).toBe(MAX_FORECAST_HOUR);
    store().setHour(-3);
    expect(store().hour).toBe(0);
  });

  it('plays to the last hour, stops there and starts over from the end', () => {
    store().setHour(MAX_FORECAST_HOUR - 1);
    store().setPlaying(true);
    store().advanceHour();
    expect(store()).toMatchObject({ hour: MAX_FORECAST_HOUR, playing: false });
    store().advanceHour();
    expect(store().hour).toBe(MAX_FORECAST_HOUR);

    store().setPlaying(true);
    expect(store()).toMatchObject({ hour: 0, playing: true });
  });

  it('keeps the chosen metric until reset', () => {
    store().setMetric('wind');
    expect(store().metric).toBe('wind');
    store().reset();
    expect(store().metric).toBe('risk');
  });
});
