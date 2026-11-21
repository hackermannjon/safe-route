import { describe, expect, it } from 'vitest';
import type { PlanResponse, Route } from '../../types/api';
import { selectPlan, useTripStore } from '../useTripStore';

const route = (id: string): Route => ({
  id,
  label: `Route ${id}`,
  via: [],
  distance_mi: 50,
  duration_s: 3600,
  geometry: { type: 'LineString', coordinates: [] },
});

const PLAN: PlanResponse = {
  routes: [route('A')],
};

const store = () => useTripStore.getState();

describe('useTripStore', () => {
  it('holds the plan until it is cleared', () => {
    store().setPlan(PLAN);
    expect(selectPlan(store())).toBe(PLAN);
    store().clearPlan();
    expect(store().plan).toBeNull();
  });
});
