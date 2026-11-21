import { describe, expect, it } from 'vitest';
import type { Checkpoint, PlanResponse, Route } from '../../types/api';
import { selectPlan, useTripStore } from '../useTripStore';

const checkpoint = (index: number): Checkpoint => ({
  index,
  mile: index * 25,
  lat: 41,
  lon: -87 - index,
  eta: '2026-11-21T14:00:00Z',
  weather: { wind_mph: 10, gust_mph: 15, rain_in_h: 0, snow_in_h: 0, temp_f: 40, weather_code: 0 },
});

const route = (id: string, checkpoints = 3): Route => ({
  id,
  label: `Route ${id}`,
  via: [],
  distance_mi: 50,
  duration_s: 3600,
  arrival: '2026-11-21T15:00:00Z',
  checkpoints: Array.from({ length: checkpoints }, (_, i) => checkpoint(i)),
  geometry: { type: 'LineString', coordinates: [] },
});

const PLAN: PlanResponse = {
  departure: '2026-11-21T14:00:00Z',
  spacing_mi: 25,
  notices: [],
  routes: [route('A', 2), route('B')],
};

const store = () => useTripStore.getState();

describe('useTripStore', () => {
  it('selects the first route when a plan arrives', () => {
    store().setPlan(PLAN);
    expect(selectPlan(store())).toBe(PLAN);
    expect(store().selectedRouteId).toBe('A');
    expect(store().selectedCheckpoint).toBeNull();
  });

  it('only selects routes and checkpoints that exist on the plan', () => {
    store().setPlan(PLAN);
    store().selectRoute('Z');
    expect(store().selectedRouteId).toBe('A');

    store().selectCheckpoint(2); // Route A has checkpoints 0 and 1 only.
    expect(store().selectedCheckpoint).toBeNull();
    store().selectCheckpoint(1);
    expect(store().selectedCheckpoint).toBe(1);
  });

  it('forgets the checkpoint when another route is selected', () => {
    store().setPlan(PLAN);
    store().selectCheckpoint(1);
    store().selectRoute('B');
    expect(store().selectedRouteId).toBe('B');
    expect(store().selectedCheckpoint).toBeNull();
  });

  it('clears the selection with the plan', () => {
    store().setPlan(PLAN);
    store().clearPlan();
    expect(store().plan).toBeNull();
    expect(store().selectedRouteId).toBeNull();
  });
});
