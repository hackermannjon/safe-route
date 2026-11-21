import { describe, expect, it } from 'vitest';
import type { HeatmapResponse } from '../types/api';
import { HeatmapDecodeError, METRIC_META, decodeHeatmap, rampColor, rampGradient } from './heatmap';

function payload(overrides: Partial<HeatmapResponse> = {}): HeatmapResponse {
  const frames = (a: number[], b: number[]) => [a, b];
  return {
    departure: '2026-11-21T14:00:00Z',
    cargo_lb: 42_000,
    grid: { lat0: 30, lon0: -82, dlat: 0.2, dlon: 0.2, rows: 2, cols: 3 },
    cells: [1, 4, 5],
    hours: ['2026-11-21T14:00:00Z', '2026-11-21T15:00:00Z'],
    values: {
      risk: { scale: 1, frames: frames([0, 1, 2], [4, 3, 0]) },
      wind_mph: { scale: 1, frames: frames([10, 20, 30], [40, 50, 60]) },
      rain_in_h: { scale: 0.01, frames: frames([0, 29, 100], [1, 2, 3]) },
      snow_in_h: { scale: 0.01, frames: frames([0, 0, 50], [0, 0, 0]) },
    },
    ...overrides,
  };
}

describe('decodeHeatmap', () => {
  it('spreads corridor values onto the full grid with the scale applied', () => {
    const data = decodeHeatmap(payload());
    expect(Array.from(data.mask)).toEqual([0, 1, 0, 0, 1, 1]);
    expect(Array.from(data.frames.risk[1])).toEqual([0, 4, 0, 0, 3, 0]);
    expect(Array.from(data.frames.wind[0])).toEqual([0, 10, 0, 0, 20, 30]);
    const rain = Array.from(data.frames.rain[0]);
    expect(rain[4]).toBeCloseTo(0.29, 5);
    expect(rain[5]).toBeCloseTo(1, 5);
    expect(data.frames.snow[0][5]).toBeCloseTo(0.5, 5);
    expect(data.hours).toHaveLength(2);
    expect(data.frames.risk[0]).toBeInstanceOf(Float32Array);
  });

  it('rejects payloads that do not match their grid', () => {
    expect(() => decodeHeatmap(payload({ cells: [1, 4, 6] }))).toThrow(HeatmapDecodeError);
    const short = payload();
    short.values.wind_mph.frames[1] = [1, 2];
    expect(() => decodeHeatmap(short)).toThrow(HeatmapDecodeError);
    const missing = payload();
    missing.values.snow_in_h.frames.pop();
    expect(() => decodeHeatmap(missing)).toThrow(/snow/);
  });
});

describe('ramps', () => {
  const ENDS = { low: [0, 0, 200], high: [200, 0, 100] } as const;

  it('interpolates between stops and clamps at the ends', () => {
    const wind = METRIC_META.wind;
    expect(rampColor(wind, -5, ENDS)).toEqual([0, 0, 200, 0]);
    expect(rampColor(wind, 500, ENDS)).toEqual([200, 0, 100, 0.76]);
    // Half way to the first visible stop: still the calm colour, half as opaque.
    const [r, , b, a] = rampColor(wind, 5, ENDS);
    expect([r, b]).toEqual([0, 200]);
    expect(a).toBeCloseTo(0.11, 5);
  });

  it('runs from the calm end to the severe end as values rise', () => {
    const rain = METRIC_META.rain;
    const light = rampColor(rain, 0.05, ENDS);
    const heavy = rampColor(rain, 0.75, ENDS);
    expect(heavy[0]).toBeGreaterThan(light[0]);
    expect(heavy[3]).toBeGreaterThan(light[3]);
  });

  it('builds a legend gradient up to the last tick', () => {
    const css = rampGradient(METRIC_META.rain);
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    expect(css).toContain('100.0%');
    expect(css).not.toContain('150.0%');
    // Mixed from the theme tokens in CSS, so the legend follows the theme.
    expect(css).toContain('var(--accent)');
    expect(css).toContain('var(--risk-notravel)');
  });
});
