export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export interface GeocodeResult extends Place {
  name: string;
}

export interface PlanRequest {
  origin: Place;
  destination: Place;
}

export interface Route {
  /** "A" for the plan's one route. */
  id: string;
  label: string;
  /** Main roads in driving order, e.g. ["I-88", "I-80", "I-76"]. */
  via: string[];
  distance_mi: number;
  duration_s: number;
  geometry: GeoJSON.LineString;
}

export interface PlanResponse {
  /** The fastest truck route, as a one-item list. */
  routes: Route[];
}

export interface ApiError {
  error: string;
  field?: string;
}
