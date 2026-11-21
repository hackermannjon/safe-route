import { describe, expect, it } from 'vitest';
import { cubicBezier } from './easing';

describe('cubicBezier', () => {
  it('is the identity for the linear curve', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const x of [0, 0.25, 0.5, 0.9, 1]) expect(linear(x)).toBeCloseTo(x, 5);
  });

  it('matches the ease curve at its midpoint and pins both ends', () => {
    // CSS `ease` is cubic-bezier(0.25, 0.1, 0.25, 1); at half the time it is about 80% of the way.
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('only ever moves forward', () => {
    const curve = cubicBezier(0.2, 0.8, 0.2, 1);
    let previous = 0;
    for (let i = 1; i <= 100; i++) {
      const value = curve(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
