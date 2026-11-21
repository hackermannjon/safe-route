import { describe, expect, it } from 'vitest';
import { formatDuration, formatMiles } from './format';

describe('formatMiles', () => {
  it('rounds to whole miles with a thousands separator', () => {
    expect(formatMiles(1016.6)).toBe('1,017 mi');
    expect(formatMiles(12.2)).toBe('12 mi');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [20, '< 1 min'],
    [59 * 60 + 59, '59 min'],
    [3600, '1 h'],
    [56_739, '15 h 45 min'],
  ])('%d s reads as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
