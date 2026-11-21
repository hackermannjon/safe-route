export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export interface GeocodeResult extends Place {
  name: string;
}

export type SpacingMi = 10 | 25 | 50;

/** Best to worst. The API classifies; the client only displays. */
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' | 'NO_TRAVEL';

/** What set a checkpoint's level; "load" means a cargo weight rule raised it. */
export type RiskFactor = 'wind' | 'rain' | 'snow' | 'load';

export interface PlanRequest {
  origin: Place;
  destination: Place;
  /** ISO 8601 with the driver's UTC offset, e.g. "2026-11-21T08:00:00-06:00". */
  departure: string;
  /** 0 to 80,000 lb. */
  cargo_lb: number;
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
  level: RiskLevel;
  factor: RiskFactor;
  /** The cargo rule that raised the level, e.g. "Wind 45 to under 55 mph with cargo over 30,000 lb". */
  load_rule: string | null;
  weather: Weather;
}

export interface RouteRisk {
  /** The worst checkpoint level on the route. */
  worst_level: RiskLevel;
  /** Mileage-weighted mean level, LOW = 0 to NO_TRAVEL = 4. */
  avg_risk: number;
  miles: Record<RiskLevel, number>;
}

export interface SegmentProperties {
  level: RiskLevel;
  from_mi: number;
  to_mi: number;
}

export interface Route {
  /** "A", "B", "C", fastest first. A name, not a rank: it stays put when the ranking changes. */
  id: string;
  label: string;
  /** 1 is the recommended route. */
  rank: number;
  recommended: boolean;
  /** One sentence on why the route ranks where it does, e.g. "12 more miles in High risk than Route B." */
  rank_reason: string;
  /** Main roads in driving order, e.g. ["I-88", "I-80", "I-76"]. */
  via: string[];
  distance_mi: number;
  duration_s: number;
  /** UTC ISO, e.g. "2026-11-22T05:44:37Z". */
  arrival: string;
  risk: RouteRisk;
  geometry: GeoJSON.LineString;
  /** Stretches of one level each, cut from `geometry`; a stretch takes the worse of its two ends. */
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentProperties>;
  /** Origin, every `spacing_mi` miles, and destination. */
  checkpoints: Checkpoint[];
}

export interface PlanResponse {
  /** The requested departure, normalized to UTC. */
  departure: string;
  cargo_lb: number;
  spacing_mi: SpacingMi;
  /** Fewest miles in the worst conditions first, then the lowest average risk, then the fastest. */
  recommended_route_id: string;
  /** Up to three distinct routes, in id order; `rank` orders them. */
  routes: Route[];
  /** Plain-language caveats about the plan, e.g. when fewer than three routes exist. */
  notices: string[];
}

export interface HeatmapRequest {
  /** The plan's departure. */
  departure: string;
  cargo_lb: number;
  /** Each planned route's `geometry.coordinates`; the corridor is drawn around all of them. */
  routes: GeoJSON.Position[][];
}

/** Server metric names; each frame value is an integer to multiply by `scale`. */
export type HeatmapWireMetric = 'risk' | 'wind_mph' | 'rain_in_h' | 'snow_in_h';

export interface HeatmapResponse {
  departure: string;
  cargo_lb: number;
  /** Cell (row, col) is centred on (lat0 + row * dlat, lon0 + col * dlon); row 0 is the southernmost. */
  grid: { lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number };
  /** Row-major indices of the cells inside the corridor, ascending. */
  cells: number[];
  /** 49 whole UTC hours: the hour nearest departure, then every hour to 48 h later. */
  hours: string[];
  /** One frame per hour, one value per entry of `cells`. Risk is the API's level, 0 = Low to 4 = No Travel. */
  values: Record<HeatmapWireMetric, { scale: number; frames: number[][] }>;
}

export interface ApiError {
  error: string;
  field?: string;
}
