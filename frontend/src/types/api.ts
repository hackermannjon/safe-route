export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export interface GeocodeResult extends Place {
  name: string;
}

export type SpacingMi = 10 | 25 | 50;

export interface PlanRequest {
  origin: Place;
  destination: Place;
  /** ISO 8601 with the driver's UTC offset, e.g. "2026-11-21T08:00:00-06:00". */
  departure: string;
  spacing_mi: SpacingMi;
}

/** Forecast for the hour nearest a checkpoint's ETA. */
export interface Weather {
  /** Sustained wind at 10 m. */
  wind_mph: number;
  gust_mph: number;
  /** Rain plus showers. */
  rain_in_h: number;
  snow_in_h: number;
  temp_f: number | null;
  /** WMO weather interpretation code; null when the model has none. */
  weather_code: number | null;
}

export interface Checkpoint {
  /** 0 is the origin; the last one is the destination. */
  index: number;
  /** Route miles from the origin. */
  mile: number;
  lat: number;
  lon: number;
  /** When the truck gets there, UTC ISO. */
  eta: string;
  weather: Weather;
}

export interface Route {
  /** "A", "B", "C", fastest first. */
  id: string;
  label: string;
  /** Main roads in driving order, e.g. ["I-88", "I-80", "I-76"]. */
  via: string[];
  distance_mi: number;
  duration_s: number;
  /** UTC ISO, e.g. "2026-11-22T05:44:37Z". */
  arrival: string;
  geometry: GeoJSON.LineString;
  /** Origin, every `spacing_mi` miles, and destination. */
  checkpoints: Checkpoint[];
}

export interface PlanResponse {
  /** The requested departure, normalized to UTC. */
  departure: string;
  spacing_mi: SpacingMi;
  /** Up to three distinct routes. */
  routes: Route[];
  /** Plain-language caveats about the plan, e.g. when fewer than three routes exist. */
  notices: string[];
}

export interface ApiError {
  error: string;
  field?: string;
}
