import type { Route } from '../types/api';

/** Where the truck is along one route over time, precomputed so a lookup is two binary searches. */
export interface Track {
  departMs: number;
  arriveMs: number;
  /** Checkpoint ETAs and route miles: the timing the API worked out for this route. */
  times: readonly number[];
  miles: readonly number[];
  /** The drawn line, [lon, lat], and the route mile at each of its points. */
  coords: readonly GeoJSON.Position[];
  lineMiles: readonly number[];
}

export interface TruckPosition {
  lon: number;
  lat: number;
  mile: number;
  arrived: boolean;
}

const EARTH_RADIUS_MI = 3958.7613;

function haversineMi([lon1, lat1]: GeoJSON.Position, [lon2, lat2]: GeoJSON.Position): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function buildTrack(route: Pick<Route, 'checkpoints' | 'geometry' | 'distance_mi' | 'arrival'>): Track | null {
  const { checkpoints, geometry } = route;
  if (checkpoints.length === 0 || geometry.coordinates.length === 0) return null;
  const times = checkpoints.map((cp) => Date.parse(cp.eta));
  const miles = checkpoints.map((cp) => cp.mile);
  const coords = geometry.coordinates;
  const raw = [0];
  for (let i = 1; i < coords.length; i++) raw.push(raw[i - 1] + haversineMi(coords[i - 1], coords[i]));
  // The drawn line is simplified, so it measures a little short of the route; stretch it to the
  // route's own miles so the truck sits on each checkpoint at that checkpoint's ETA.
  const total = raw[raw.length - 1];
  const scale = total > 0 ? route.distance_mi / total : 0;
  return {
    departMs: times[0],
    arriveMs: Math.max(times[times.length - 1], Date.parse(route.arrival) || 0),
    times,
    miles,
    coords,
    lineMiles: raw.map((m) => m * scale),
  };
}

/** Index i with values[i] <= target < values[i + 1], clamped to the ends. */
function segmentAt(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lerpAt(xs: readonly number[], ys: readonly number[], x: number): number {
  if (xs.length === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const i = segmentAt(xs, x);
  const span = xs[i + 1] - xs[i];
  return span > 0 ? ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / span : ys[i + 1];
}

/**
 * The truck's position at a moment: linear in time between checkpoint ETAs, then placed on the
 * drawn line by route mile. Before departure it waits at the origin; from arrival on it is at
 * the destination.
 */
export function truckAt(track: Track, atMs: number): TruckPosition {
  const arrived = atMs >= track.arriveMs;
  const mile = arrived ? track.miles[track.miles.length - 1] : lerpAt(track.times, track.miles, atMs);
  const { coords, lineMiles } = track;
  if (coords.length === 1 || mile <= 0)
    return { lon: coords[0][0], lat: coords[0][1], mile: Math.max(0, mile), arrived };
  const last = coords.length - 1;
  if (mile >= lineMiles[last]) return { lon: coords[last][0], lat: coords[last][1], mile, arrived };
  const i = segmentAt(lineMiles, mile);
  const span = lineMiles[i + 1] - lineMiles[i];
  const t = span > 0 ? (mile - lineMiles[i]) / span : 0;
  const [lon1, lat1] = coords[i];
  const [lon2, lat2] = coords[i + 1];
  return { lon: lon1 + (lon2 - lon1) * t, lat: lat1 + (lat2 - lat1) * t, mile, arrived };
}
