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
  /**
   * The route line driven over the past hour, ending here. Playback glides the truck along it, so
   * the marker keeps to the road instead of cutting across between hourly positions.
   */
  trail: readonly GeoJSON.Position[];
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

const HOUR_MS = 3_600_000;

function mileAt(track: Track, atMs: number): number {
  if (atMs >= track.arriveMs) return track.miles[track.miles.length - 1];
  return Math.max(0, lerpAt(track.times, track.miles, atMs));
}

/** The point on the drawn line at a route mile, clamped to its ends. */
function pointAtMile({ coords, lineMiles }: Track, mile: number): GeoJSON.Position {
  const last = coords.length - 1;
  if (last === 0 || mile <= 0) return coords[0];
  if (mile >= lineMiles[last]) return coords[last];
  const i = segmentAt(lineMiles, mile);
  const span = lineMiles[i + 1] - lineMiles[i];
  const t = span > 0 ? (mile - lineMiles[i]) / span : 0;
  const [lon1, lat1] = coords[i];
  const [lon2, lat2] = coords[i + 1];
  return [lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t];
}

/** The drawn line from one route mile to a later one, both ends included. */
export function lineBetween(track: Track, fromMile: number, toMile: number): GeoJSON.Position[] {
  const line = [pointAtMile(track, fromMile)];
  const { coords, lineMiles } = track;
  for (let i = 0; i < coords.length; i++) {
    if (lineMiles[i] > fromMile && lineMiles[i] < toMile) line.push(coords[i]);
  }
  if (toMile > fromMile) line.push(pointAtMile(track, toMile));
  return line;
}

/**
 * The truck's position at a moment: linear in time between checkpoint ETAs, then placed on the
 * drawn line by route mile. Before departure it waits at the origin; from arrival on it is at
 * the destination.
 */
export function truckAt(track: Track, atMs: number): TruckPosition {
  const arrived = atMs >= track.arriveMs;
  const mile = mileAt(track, atMs);
  const [lon, lat] = pointAtMile(track, mile);
  return { lon, lat, mile, arrived, trail: lineBetween(track, mileAt(track, atMs - HOUR_MS), mile) };
}

/**
 * A walker over a line: the point a fraction of its length along, measured on the ground, so a
 * steady fraction is a steady speed however unevenly the line's points are spaced.
 */
export function walkLine(line: readonly GeoJSON.Position[]): (fraction: number) => [number, number] {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + haversineMi(line[i - 1], line[i]));
  const total = lengths[lengths.length - 1];
  return (fraction) => {
    const last = line[line.length - 1];
    if (total <= 0 || fraction >= 1) return [last[0], last[1]];
    const target = Math.max(0, fraction) * total;
    const i = segmentAt(lengths, target);
    const span = lengths[i + 1] - lengths[i];
    const t = span > 0 ? (target - lengths[i]) / span : 0;
    const [lon1, lat1] = line[i];
    const [lon2, lat2] = line[i + 1];
    return [lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t];
  };
}
