import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Route } from '../../types/api';
import type { MapPalette } from './mapPalette';

const SOURCE = 'routes';

const ROUTE_LAYER = {
  casing: 'route-casing',
  line: 'route-line',
} as const;

type LineFC = GeoJSON.FeatureCollection<GeoJSON.LineString>;
export type Bounds = [[number, number], [number, number]];

export function routeFeatures(routes: readonly Route[]): LineFC {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.geometry.coordinates.length >= 2)
      .map((route) => ({ type: 'Feature', properties: {}, geometry: route.geometry })),
  };
}

export function routesBounds(routes: readonly Route[]): Bounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const route of routes) {
    for (const [lon, lat] of route.geometry.coordinates) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return Number.isFinite(minLon)
    ? [
        [minLon, minLat],
        [maxLon, maxLat],
      ]
    : null;
}

const ROUND = { 'line-join': 'round', 'line-cap': 'round' } as const;

/** `beforeId` keeps the lines under the basemap labels so place names stay readable. */
export function installRouteLayers(map: MapLibreMap, palette: MapPalette, beforeId?: string): void {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, { type: 'geojson', data: routeFeatures([]) });
  const line = (id: string, paint: Record<string, unknown>) =>
    map.addLayer({ id, type: 'line', source: SOURCE, layout: ROUND, paint }, beforeId);

  line(ROUTE_LAYER.casing, { 'line-color': palette.casing, 'line-width': 9 });
  line(ROUTE_LAYER.line, { 'line-color': palette.route, 'line-width': 5 });
}

export function setRouteData(map: MapLibreMap, routes: readonly Route[]): void {
  map.getSource<GeoJSONSource>(SOURCE)?.setData(routeFeatures(routes));
}
