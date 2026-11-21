import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../../types/api';
import { riskColorExpression } from './riskStyle';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ROUTE_LAYER, pickRoute, riskSegments, routeFeatures, routesBounds, setRouteSelection } from './routes';

function route(id: string, coordinates: GeoJSON.Position[]): Route {
  return {
    id,
    label: `Route ${id}`,
    rank: 1,
    recommended: true,
    rank_reason: '',
    via: [],
    distance_mi: 1,
    duration_s: 1,
    arrival: '2026-11-21T14:00:01Z',
    checkpoints: [],
    risk: { worst_level: 'LOW', avg_risk: 0, miles: { LOW: 1, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: 0 } },
    geometry: { type: 'LineString', coordinates },
    segments: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { level: 'LOW', from_mi: 0, to_mi: 1 },
          geometry: { type: 'LineString', coordinates },
        },
      ],
    },
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

function mapHitting(...ids: string[]) {
  const queryRenderedFeatures = vi.fn(() => ids.map((routeId) => ({ properties: { routeId } })));
  return { queryRenderedFeatures } as unknown as Parameters<typeof pickRoute>[0] & {
    queryRenderedFeatures: typeof queryRenderedFeatures;
  };
}

describe('route map helpers', () => {
  it('tags each route line with its id and skips lines too short to draw', () => {
    const features = routeFeatures([A, route('X', [[-90, 40]]), B]).features;
    expect(features.map((f) => f.properties.routeId)).toEqual(['A', 'B']);
  });

  it('bounds every route, not just one', () => {
    expect(routesBounds([A, B])).toEqual([
      [-104.9, 39.7],
      [-87.6, 43.5],
    ]);
    expect(routesBounds([])).toBeNull();
  });

  it('picks the route under the pointer from the wide hit layer', () => {
    const map = mapHitting('B');
    expect(pickRoute(map, { x: 10, y: 20 }, 'A')).toBe('B');
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith([10, 20], { layers: [ROUTE_LAYER.hit] });
  });

  it('keeps the selection where routes share a road', () => {
    expect(pickRoute(mapHitting('A', 'B'), { x: 0, y: 0 }, 'B')).toBe('B');
    expect(pickRoute(mapHitting(), { x: 0, y: 0 }, 'B')).toBeNull();
  });

  it('draws the risk segments of the selected route only, skipping any too short to draw', () => {
    const withDot: Route = {
      ...B,
      segments: {
        type: 'FeatureCollection',
        features: [
          ...B.segments.features,
          {
            type: 'Feature',
            properties: { level: 'SEVERE', from_mi: 1, to_mi: 1 },
            geometry: { type: 'LineString', coordinates: [[-104.9, 39.7]] },
          },
        ],
      },
    };
    expect(riskSegments(withDot).features.map((f) => f.properties.level)).toEqual(['LOW']);
    expect(riskSegments(undefined).features).toEqual([]);
  });

  it('colours segments by level with grey for anything unknown', () => {
    const colors = { LOW: '#1', MODERATE: '#2', HIGH: '#3', SEVERE: '#4', NO_TRAVEL: '#5' };
    expect(riskColorExpression(colors, 'gray')).toEqual([
      'match',
      ['get', 'level'],
      'LOW',
      '#1',
      'MODERATE',
      '#2',
      'HIGH',
      '#3',
      'SEVERE',
      '#4',
      'NO_TRAVEL',
      '#5',
      'gray',
    ]);
  });
});

describe('setRouteSelection', () => {
  const fakeMap = (loaded: boolean) => {
    const setFilter = vi.fn(() => {
      if (!loaded) throw new Error('Style is not done loading.');
    });
    const map = { getLayer: (id: string) => (loaded ? { id } : undefined), setFilter };
    return { map: map as unknown as MapLibreMap, setFilter };
  };

  it('filters the selected route apart from the others', () => {
    const { map, setFilter } = fakeMap(true);
    setRouteSelection(map, 'B');
    expect(setFilter).toHaveBeenCalledWith(ROUTE_LAYER.alt, ['!=', ['get', 'routeId'], 'B']);
    expect(setFilter).toHaveBeenCalledWith(ROUTE_LAYER.selectedCasing, ['==', ['get', 'routeId'], 'B']);
  });

  it('waits while a theme swap is loading the next style', () => {
    const { map, setFilter } = fakeMap(false);
    expect(() => setRouteSelection(map, 'B')).not.toThrow();
    expect(setFilter).not.toHaveBeenCalled();
  });
});
