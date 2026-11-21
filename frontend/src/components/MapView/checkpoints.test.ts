import { describe, expect, it, vi } from 'vitest';
import type { Checkpoint } from '../../types/api';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  CHECKPOINT_LAYER,
  PICK_RADIUS_PX,
  checkpointFeatures,
  pickCheckpoint,
  setCheckpointFocus,
} from './checkpoints';

const cp = (index: number, lon: number, lat: number): Checkpoint => ({
  index,
  mile: index * 25,
  lat,
  lon,
  eta: '2026-11-21T14:00:00Z',
});

describe('checkpoint map helpers', () => {
  it('marks the first and last checkpoints as the route ends', () => {
    const features = checkpointFeatures([cp(0, -87.6, 41.9), cp(1, -88, 41.8), cp(2, -88.4, 41.7)]).features;
    expect(features.map((f) => f.properties)).toEqual([
      { index: 0, kind: 'origin' },
      { index: 1, kind: 'stop' },
      { index: 2, kind: 'destination' },
    ]);
    expect(features[1].geometry.coordinates).toEqual([-88, 41.8]);
    expect(checkpointFeatures([]).features).toEqual([]);
  });

  it('picks the dot nearest the click among those in reach', () => {
    const hits = [
      { geometry: { type: 'Point', coordinates: [1, 0] }, properties: { index: 4 } },
      { geometry: { type: 'Point', coordinates: [2, 0] }, properties: { index: 5 } },
    ];
    const map = {
      queryRenderedFeatures: vi.fn(() => hits),
      // One degree of longitude is 10px here, so index 5 sits 2px from the click.
      project: ([lon, lat]: [number, number]) => ({ x: 100 + lon * 10, y: 100 + lat * 10 }),
    } as unknown as Parameters<typeof pickCheckpoint>[0];

    expect(pickCheckpoint(map, { x: 118, y: 100 })).toBe(5);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [
        [118 - PICK_RADIUS_PX, 100 - PICK_RADIUS_PX],
        [118 + PICK_RADIUS_PX, 100 + PICK_RADIUS_PX],
      ],
      { layers: [CHECKPOINT_LAYER.stops, CHECKPOINT_LAYER.ends] },
    );
  });

  it('finds nothing when no dot is in reach', () => {
    const map = { queryRenderedFeatures: () => [], project: () => ({ x: 0, y: 0 }) } as unknown as Parameters<
      typeof pickCheckpoint
    >[0];
    expect(pickCheckpoint(map, { x: 5, y: 5 })).toBeNull();
  });
});

describe('setCheckpointFocus', () => {
  it('waits while a theme swap is loading the next style', () => {
    const setFilter = vi.fn(() => {
      throw new Error('Style is not done loading.');
    });
    const map = { getLayer: () => undefined, setFilter } as unknown as MapLibreMap;
    expect(() => setCheckpointFocus(map, 2)).not.toThrow();
    expect(setFilter).not.toHaveBeenCalled();
  });
});
