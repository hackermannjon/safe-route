import type { HeatmapResponse, HeatmapWireMetric } from '../types/api';

export type HeatmapMetric = 'risk' | 'wind' | 'rain' | 'snow';

export const HEATMAP_METRICS: readonly HeatmapMetric[] = ['risk', 'wind', 'rain', 'snow'];

const WIRE: Readonly<Record<HeatmapMetric, HeatmapWireMetric>> = {
  risk: 'risk',
  wind: 'wind_mph',
  rain: 'rain_in_h',
  snow: 'snow_in_h',
};

/** The slider's last hour: departure plus two days. */
export const MAX_FORECAST_HOUR = 48;
/** One forecast hour per step while playing. */
export const PLAY_STEP_MS = 700;

export interface HeatmapGrid {
  lat0: number;
  lon0: number;
  dlat: number;
  dlon: number;
  rows: number;
  cols: number;
}

export interface HeatmapData {
  grid: HeatmapGrid;
  /** 1 for cells inside the corridor, row-major from the south-west cell. */
  mask: Uint8Array;
  /** UTC ISO, one per frame. */
  hours: readonly string[];
  /** Per metric, one array per hour with a value for every grid cell (0 outside the corridor). */
  frames: Readonly<Record<HeatmapMetric, readonly Float32Array[]>>;
  /** The route lines the corridor was built around, [lon, lat], which shape its drawn outline. */
  routes: readonly (readonly GeoJSON.Position[])[];
}

export class HeatmapDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeatmapDecodeError';
  }
}

/**
 * Spreads the corridor's values onto the full grid once, as typed arrays, so drawing an hour is
 * plain indexing with no per-hour allocation.
 */
export function decodeHeatmap(
  payload: HeatmapResponse,
  routes: readonly (readonly GeoJSON.Position[])[] = [],
): HeatmapData {
  const { grid, cells, hours, values } = payload;
  const size = grid.rows * grid.cols;
  if (!(grid.rows > 0 && grid.cols > 0 && Number.isInteger(size))) throw new HeatmapDecodeError('Bad grid size.');
  const mask = new Uint8Array(size);
  for (const index of cells) {
    if (!Number.isInteger(index) || index < 0 || index >= size) throw new HeatmapDecodeError('Cell outside the grid.');
    mask[index] = 1;
  }
  const frames = {} as Record<HeatmapMetric, Float32Array[]>;
  for (const metric of HEATMAP_METRICS) {
    const wire = values[WIRE[metric]];
    if (!wire || wire.frames.length !== hours.length) throw new HeatmapDecodeError(`Missing ${metric} frames.`);
    frames[metric] = wire.frames.map((frame) => {
      if (frame.length !== cells.length) throw new HeatmapDecodeError(`Short ${metric} frame.`);
      const full = new Float32Array(size);
      for (let i = 0; i < cells.length; i++) full[cells[i]] = frame[i] * wire.scale;
      return full;
    });
  }
  return { grid, mask, hours, frames, routes };
}

/** [red, green, blue, alpha], alpha 0..1. */
export type Rgba = readonly [number, number, number, number];
export type Rgb = readonly [number, number, number];

export interface RampStop {
  at: number;
  /** Share of the severe end colour mixed into the calm end, 0..1. */
  mix: number;
  /** Opacity over the map, 0..1. */
  alpha: number;
}

export interface MetricMeta {
  label: string;
  /** Unit after a value in the legend; empty for risk. */
  unit: string;
  /** Values past the last stop take its colour. */
  max: number;
  /** Ramp stops in value order. Display only: levels are classified by the API. */
  stops: readonly RampStop[];
  /** Legend tick values. */
  ticks: readonly number[];
}

// Each ramp runs from the accent towards the No Travel colour, both theme tokens, so the field
// follows the theme and weather never borrows the risk colours it could be mistaken for. A dry
// or calm area stays clear, so only weather is painted.
export const METRIC_META: Readonly<Record<Exclude<HeatmapMetric, 'risk'>, MetricMeta>> = {
  wind: {
    label: 'Wind',
    unit: 'mph',
    max: 70,
    stops: [
      { at: 0, mix: 0, alpha: 0 },
      { at: 10, mix: 0, alpha: 0.22 },
      { at: 25, mix: 0.25, alpha: 0.42 },
      { at: 40, mix: 0.55, alpha: 0.56 },
      { at: 55, mix: 0.85, alpha: 0.68 },
      { at: 70, mix: 1, alpha: 0.76 },
    ],
    ticks: [0, 20, 40, 60],
  },
  rain: {
    label: 'Rain',
    unit: 'in/h',
    max: 1.5,
    stops: [
      { at: 0, mix: 0, alpha: 0 },
      { at: 0.04, mix: 0.05, alpha: 0.26 },
      { at: 0.1, mix: 0.2, alpha: 0.44 },
      { at: 0.25, mix: 0.45, alpha: 0.56 },
      { at: 0.5, mix: 0.75, alpha: 0.66 },
      { at: 1, mix: 1, alpha: 0.76 },
    ],
    ticks: [0, 0.25, 0.5, 1],
  },
  snow: {
    label: 'Snow',
    unit: 'in/h',
    max: 3.5,
    stops: [
      { at: 0, mix: 0, alpha: 0 },
      { at: 0.15, mix: 0.08, alpha: 0.3 },
      { at: 0.5, mix: 0.3, alpha: 0.48 },
      { at: 1, mix: 0.55, alpha: 0.58 },
      { at: 2, mix: 0.8, alpha: 0.68 },
      { at: 3, mix: 1, alpha: 0.76 },
    ],
    ticks: [0, 1, 2, 3],
  },
};

/** Risk fill opacity by level: Low is a tint that shows coverage, worse levels stand out. */
export const RISK_FIELD_ALPHA: readonly number[] = [0.22, 0.5, 0.58, 0.66, 0.74];

export const METRIC_LABEL: Readonly<Record<HeatmapMetric, string>> = {
  risk: 'Risk',
  wind: METRIC_META.wind.label,
  rain: METRIC_META.rain.label,
  snow: METRIC_META.snow.label,
};

/** The two theme colours a weather ramp runs between. */
export interface RampEnds {
  low: Rgb;
  high: Rgb;
}

/** Where a value sits on a ramp, linear between stops. */
export function rampAt(meta: Pick<MetricMeta, 'stops'>, value: number): { mix: number; alpha: number } {
  const { stops } = meta;
  if (!(value > stops[0].at)) return stops[0];
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i];
    if (value <= hi.at) {
      const lo = stops[i - 1];
      const t = (value - lo.at) / (hi.at - lo.at);
      return { mix: lo.mix + (hi.mix - lo.mix) * t, alpha: lo.alpha + (hi.alpha - lo.alpha) * t };
    }
  }
  return stops[stops.length - 1];
}

/** Colour of a ramp at a value, between the theme's two end colours. */
export function rampColor(meta: Pick<MetricMeta, 'stops'>, value: number, ends: RampEnds): Rgba {
  const { mix, alpha } = rampAt(meta, value);
  const channel = (k: number) => ends.low[k] + (ends.high[k] - ends.low[k]) * mix;
  return [channel(0), channel(1), channel(2), alpha];
}

/**
 * CSS for a legend bar from 0 to the ramp's last tick. It mixes the same two tokens in the
 * stylesheet, so the legend follows the theme without being re-rendered.
 */
export function rampGradient(meta: MetricMeta): string {
  const end = meta.ticks[meta.ticks.length - 1];
  const parts = meta.stops
    .filter((stop) => stop.at <= end)
    .map(({ at, mix, alpha }) => {
      const color = `color-mix(in srgb, var(--risk-notravel) ${Math.round(mix * 100)}%, var(--accent))`;
      return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent) ${((at / end) * 100).toFixed(1)}%`;
    });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
