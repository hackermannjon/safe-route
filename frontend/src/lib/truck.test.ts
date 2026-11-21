import { describe, expect, it } from 'vitest';
import type { Checkpoint, Route } from '../types/api';
import { buildTrack, truckAt, walkLine } from './truck';

const DEPART = Date.parse('2026-11-21T14:00:00Z');
const HOUR = 3_600_000;

function checkpoint(index: number, mile: number, hours: number): Checkpoint {
  return {
    index,
    mile,
    lat: 0,
    lon: 0,
    eta: new Date(DEPART + hours * HOUR).toISOString(),
    level: 'LOW',
    factor: 'wind',
    load_rule: null,
    weather: { wind_mph: 0, gust_mph: 0, rain_in_h: 0, snow_in_h: 0, temp_f: null, weather_code: null },
  };
}

// An L along the equator then north: 1 degree each way, ~69.1 mi per leg.
const LEG = 69.093;
const ROUTE: Pick<Route, 'checkpoints' | 'geometry' | 'distance_mi' | 'arrival'> = {
  distance_mi: 2 * LEG,
  arrival: new Date(DEPART + 3 * HOUR).toISOString(),
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  },
  // Slow first leg (2 h), fast second (1 h): position must follow the ETAs, not a constant speed.
  checkpoints: [checkpoint(0, 0, 0), checkpoint(1, LEG, 2), checkpoint(2, 2 * LEG, 3)],
};

describe('truckAt', () => {
  const track = buildTrack(ROUTE)!;

  it('starts at the origin at departure', () => {
    expect(truckAt(track, DEPART)).toMatchObject({ lon: 0, lat: 0, mile: 0, arrived: false });
  });

  it('follows checkpoint ETAs, not an average speed', () => {
    const oneHour = truckAt(track, DEPART + HOUR);
    expect(oneHour.mile).toBeCloseTo(LEG / 2, 3);
    expect(oneHour.lon).toBeCloseTo(0.5, 3);
    expect(oneHour.lat).toBeCloseTo(0, 6);
    const twoAndHalf = truckAt(track, DEPART + 2.5 * HOUR);
    expect(twoAndHalf.lon).toBeCloseTo(1, 6);
    expect(twoAndHalf.lat).toBeCloseTo(0.5, 2);
    expect(twoAndHalf.arrived).toBe(false);
  });

  it('sits on a checkpoint at its ETA', () => {
    const atCorner = truckAt(track, DEPART + 2 * HOUR);
    expect(atCorner.lon).toBeCloseTo(1, 3);
    expect(atCorner.lat).toBeCloseTo(0, 3);
  });

  it('stays at the destination once arrived', () => {
    for (const hours of [3, 4, 48]) {
      expect(truckAt(track, DEPART + hours * HOUR)).toMatchObject({ lon: 1, lat: 1, mile: 2 * LEG, arrived: true });
    }
  });

  it('stretches a simplified line to the route miles', () => {
    // The API measured 10% more than the drawn line; halfway in time is halfway along the line.
    const longer = buildTrack({
      ...ROUTE,
      distance_mi: 2.2 * LEG,
      checkpoints: [checkpoint(0, 0, 0), checkpoint(1, 2.2 * LEG, 2)],
      arrival: new Date(DEPART + 2 * HOUR).toISOString(),
    })!;
    const half = truckAt(longer, DEPART + HOUR);
    expect(half.lon).toBeCloseTo(1, 3);
    expect(half.lat).toBeCloseTo(0, 3);
  });

  it('handles a route without data', () => {
    expect(buildTrack({ ...ROUTE, checkpoints: [] })).toBeNull();
  });

  it('trails the road driven over the past hour, round the corner rather than across it', () => {
    // 1.5 h to 2.5 h crosses the corner at (1, 0): the trail must pass through it.
    const trail = truckAt(track, DEPART + 2.5 * HOUR).trail;
    expect(trail[0][0]).toBeCloseTo(0.75, 3);
    expect(trail[0][1]).toBeCloseTo(0, 6);
    expect(trail).toContainEqual([1, 0]);
    const end = trail[trail.length - 1];
    expect(end[0]).toBeCloseTo(1, 6);
    expect(end[1]).toBeCloseTo(0.5, 2);
  });

  it('has a one-point trail while waiting at the origin or after arriving', () => {
    expect(truckAt(track, DEPART).trail).toHaveLength(1);
    expect(truckAt(track, DEPART + 5 * HOUR).trail).toHaveLength(1);
  });
});

describe('walkLine', () => {
  it('moves at a steady ground speed along a bent line, so it never cuts the corner', () => {
    const along = walkLine([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(along(0)).toEqual([0, 0]);
    const quarter = along(0.25);
    expect(quarter[0]).toBeCloseTo(0.5, 2);
    expect(quarter[1]).toBeCloseTo(0, 6);
    const half = along(0.5);
    expect(half[0]).toBeCloseTo(1, 2);
    expect(half[1]).toBeCloseTo(0, 2);
    const threeQuarters = along(0.75);
    expect(threeQuarters[0]).toBeCloseTo(1, 6);
    expect(threeQuarters[1]).toBeCloseTo(0.5, 2);
    expect(along(1)).toEqual([1, 1]);
  });

  it('stays on a single point', () => {
    expect(walkLine([[2, 3]])(0.5)).toEqual([2, 3]);
  });
});
