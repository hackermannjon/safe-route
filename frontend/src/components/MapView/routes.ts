import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Route } from '../../types/api';
import type { MapPalette } from './mapPalette';

// All candidate routes live in one source; selection only swaps layer filters, so a
// click never re-uploads geometry.

const SOURCE = 'routes';

export const ROUTE_LAYER = {
  altCasing: 'route-alt-casing',
  alt: 'route-alt',
  selectedCasing: 'route-selected-casing',
  selected: 'route-selected',
  hit: 'route-hit',
} as const;

/** Invisible line width, in px, that takes clicks; a thumb should not have to hit a 4px line. */
export const HIT_WIDTH_PX = 28;

type LineFC = GeoJSON.FeatureCollection<GeoJSON.LineString, { routeId: string }>;
export type Bounds = [[number, number], [number, number]];

export function routeFeatures(routes: readonly Route[]): LineFC {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.geometry.coordinates.length >= 2)
      .map((route) => ({ type: 'Feature', properties: { routeId: route.id }, geometry: route.geometry })),
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
const NONE: FilterSpecification = ['==', ['get', 'routeId'], ''];

/** `beforeId` keeps the lines under the basemap labels so place names stay readable. */
export function installRouteLayers(map: MapLibreMap, palette: MapPalette, beforeId?: string): void {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, { type: 'geojson', data: routeFeatures([]) });
  const line = (id: string, paint: Record<string, unknown>, filter: FilterSpecification = NONE) =>
    map.addLayer({ id, type: 'line', source: SOURCE, filter, layout: ROUND, paint }, beforeId);

  line(ROUTE_LAYER.altCasing, { 'line-color': palette.casing, 'line-width': 6 });
  line(ROUTE_LAYER.alt, { 'line-color': palette.alternative, 'line-width': 3.5 });
  line(ROUTE_LAYER.selectedCasing, { 'line-color': palette.casing, 'line-width': 9 });
  line(ROUTE_LAYER.selected, { 'line-color': palette.selected, 'line-width': 5 });
  line(ROUTE_LAYER.hit, { 'line-color': palette.casing, 'line-width': HIT_WIDTH_PX, 'line-opacity': 0 }, [
    'has',
    'routeId',
  ]);
}

export function setRouteData(map: MapLibreMap, routes: readonly Route[]): void {
  map.getSource<GeoJSONSource>(SOURCE)?.setData(routeFeatures(routes));
}

export function setRouteSelection(map: MapLibreMap, selectedRouteId: string | null): void {
  // While a theme swap loads the next style, setFilter throws; style.load runs this again.
  if (!map.getLayer(ROUTE_LAYER.alt)) return;
  const id = selectedRouteId ?? '';
  const others: FilterSpecification = ['!=', ['get', 'routeId'], id];
  const selected: FilterSpecification = ['==', ['get', 'routeId'], id];
  map.setFilter(ROUTE_LAYER.altCasing, others);
  map.setFilter(ROUTE_LAYER.alt, others);
  map.setFilter(ROUTE_LAYER.selectedCasing, selected);
  map.setFilter(ROUTE_LAYER.selected, selected);
}

/**
 * Route under a screen point. Where routes share a highway the current selection
 * wins, so clicking a shared stretch never flips the selection.
 */
export function pickRoute(
  map: Pick<MapLibreMap, 'queryRenderedFeatures'>,
  point: { x: number; y: number },
  selectedRouteId: string | null,
): string | null {
  const hits = map.queryRenderedFeatures([point.x, point.y], { layers: [ROUTE_LAYER.hit] });
  const ids = hits.map((feature) => String(feature.properties.routeId));
  if (ids.length === 0) return null;
  return selectedRouteId && ids.includes(selectedRouteId) ? selectedRouteId : ids[0];
}
