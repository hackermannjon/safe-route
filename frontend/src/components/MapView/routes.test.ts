import { describe, expect, it } from 'vitest';
import type { Route } from '../../types/api';
import { routeFeatures, routesBounds } from './routes';

function route(id: string, coordinates: GeoJSON.Position[]): Route {
  return {
    id,
    label: `Route ${id}`,
    via: [],
    distance_mi: 1,
    duration_s: 1,
    geometry: { type: 'LineString', coordinates },
  };
}

const A = route('A', [
  [-87.6, 41.9],
  [-104.9, 39.7],
]);
const B = route('B', [
  [-87.6, 41.9],
  [-95.0, 43.5],
  [-104.9, 39.7],
]);

describe('route map helpers', () => {
  it('skips lines too short to draw', () => {
    const features = routeFeatures([A, route('X', [[-90, 40]]), B]).features;
    expect(features.map((f) => f.geometry)).toEqual([A.geometry, B.geometry]);
  });

  it('bounds every route, not just one', () => {
    expect(routesBounds([A, B])).toEqual([
      [-104.9, 39.7],
      [-87.6, 43.5],
    ]);
    expect(routesBounds([])).toBeNull();
  });
});
