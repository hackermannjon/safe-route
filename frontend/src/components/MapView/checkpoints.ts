import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Checkpoint, RiskLevel } from '../../types/api';
import { GLYPH_IMAGE_PREFIX, type MapPalette } from './riskStyle';

// Only the selected route's checkpoints are on the map; a new selection replaces the data.

const SOURCE = 'checkpoints';

export const CHECKPOINT_LAYER = {
  focus: 'checkpoint-focus',
  ends: 'checkpoint-ends',
  glyphs: 'checkpoint-glyphs',
} as const;

const CLICKABLE = [CHECKPOINT_LAYER.glyphs, CHECKPOINT_LAYER.ends];

/** Half the side of the square searched around a click; a fingertip is far wider than a 4px dot. */
export const PICK_RADIUS_PX = 12;

export type CheckpointKind = 'origin' | 'stop' | 'destination';
type PointFC = GeoJSON.FeatureCollection<GeoJSON.Point, { index: number; kind: CheckpointKind; level: RiskLevel }>;

export function checkpointKind(index: number, count: number): CheckpointKind {
  if (index === 0) return 'origin';
  return index === count - 1 ? 'destination' : 'stop';
}

export function checkpointFeatures(checkpoints: readonly Checkpoint[]): PointFC {
  return {
    type: 'FeatureCollection',
    features: checkpoints.map((cp, i) => ({
      type: 'Feature',
      properties: { index: cp.index, kind: checkpointKind(i, checkpoints.length), level: cp.level },
      geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
    })),
  };
}

const IS_STOP: ExpressionSpecification = ['==', ['get', 'kind'], 'stop'];

const focusFilter = (index: number | null): FilterSpecification => ['==', ['get', 'index'], index ?? -1];

/** Drawn above everything else, labels included, so every dot stays visible and clickable. */
export function installCheckpointLayers(map: MapLibreMap, palette: MapPalette): void {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, { type: 'geojson', data: checkpointFeatures([]) });
  map.addLayer({
    id: CHECKPOINT_LAYER.focus,
    type: 'circle',
    source: SOURCE,
    filter: focusFilter(null),
    paint: {
      'circle-radius': 13,
      'circle-color': palette.focus,
      'circle-opacity': 0.25,
      'circle-stroke-color': palette.focus,
      'circle-stroke-width': 2,
    },
  });
  // Origin: hollow ring; destination: solid disc. They frame the level glyph drawn on top.
  map.addLayer({
    id: CHECKPOINT_LAYER.ends,
    type: 'circle',
    source: SOURCE,
    filter: ['!=', ['get', 'kind'], 'stop'],
    paint: {
      'circle-radius': 11,
      'circle-color': ['match', ['get', 'kind'], 'origin', palette.surface, palette.ink],
      'circle-stroke-color': ['match', ['get', 'kind'], 'origin', palette.ink, palette.surface],
      'circle-stroke-width': ['match', ['get', 'kind'], 'origin', 3, 2],
    },
  });
  // Every checkpoint, ends included, shows its level as a shape, so the map reads without colour.
  map.addLayer({
    id: CHECKPOINT_LAYER.glyphs,
    type: 'symbol',
    source: SOURCE,
    layout: {
      'icon-image': ['concat', GLYPH_IMAGE_PREFIX, ['get', 'level']],
      // Small at country scale, where 10 mi is a few pixels and full-size glyphs would merge.
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        ['case', IS_STOP, 0.45, 0.8],
        6,
        ['case', IS_STOP, 0.7, 0.8],
        9,
        ['case', IS_STOP, 1, 0.8],
      ],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Ends on top of the stops around them.
      'symbol-sort-key': ['match', ['get', 'kind'], 'stop', 0, 1],
    },
  });
}

export function setCheckpointData(map: MapLibreMap, checkpoints: readonly Checkpoint[]): void {
  map.getSource<GeoJSONSource>(SOURCE)?.setData(checkpointFeatures(checkpoints));
}

export function setCheckpointFocus(map: MapLibreMap, index: number | null): void {
  // While a theme swap loads the next style, setFilter throws; style.load runs this again.
  if (!map.getLayer(CHECKPOINT_LAYER.focus)) return;
  map.setFilter(CHECKPOINT_LAYER.focus, focusFilter(index));
}

/** Index of the checkpoint nearest a screen point, within PICK_RADIUS_PX, or null. */
export function pickCheckpoint(
  map: Pick<MapLibreMap, 'queryRenderedFeatures' | 'project'>,
  point: { x: number; y: number },
): number | null {
  const r = PICK_RADIUS_PX;
  const hits = map.queryRenderedFeatures(
    [
      [point.x - r, point.y - r],
      [point.x + r, point.y + r],
    ],
    { layers: CLICKABLE },
  );
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const hit of hits) {
    if (hit.geometry.type !== 'Point') continue;
    const at = map.project(hit.geometry.coordinates as [number, number]);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = Number(hit.properties.index);
    }
  }
  return best;
}
