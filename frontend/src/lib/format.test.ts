import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatEta,
  formatMilepost,
  formatMiles,
  formatRate,
  formatTemp,
  formatWind,
  isMeasurable,
} from './format';

describe('formatMiles', () => {
  it('rounds to whole miles with a thousands separator', () => {
    expect(formatMiles(1016.6)).toBe('1,017 mi');
    expect(formatMiles(12.2)).toBe('12 mi');
  });
});

describe('formatMilepost', () => {
  it('names a whole route mile', () => {
    expect(formatMilepost(25)).toBe('Mile 25');
    expect(formatMilepost(1016.4)).toBe('Mile 1,016');
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

describe('formatEta', () => {
  it('reads as a weekday and a 12-hour clock in the given zone', () => {
    expect(formatEta('2026-11-21T14:00:00Z', 'America/Chicago')).toBe('Sat 8:00 AM');
    expect(formatEta('2026-11-22T05:44:37Z', 'America/Denver')).toBe('Sat 10:44 PM');
    expect(formatEta('2026-11-21T14:00:00Z', 'UTC')).toBe('Sat 2:00 PM');
  });

  it('uses the browser zone by default', () => {
    expect(formatEta('2026-11-21T14:00:00Z')).toBe('Sat 8:00 AM');
  });

  it('shows a dash for an unreadable time', () => {
    expect(formatEta('soon')).toBe('—');
  });
});

describe('weather readings', () => {
  it('truncates wind so a value under a threshold never reads as it', () => {
    expect(formatWind(24.9)).toBe('24 mph');
    expect(formatWind(0)).toBe('0 mph');
    expect(formatWind(Number.NaN)).toBe('—');
  });

  it.each([
    [0, '0 in/h'],
    [0.004, '< 0.01 in/h'],
    [0.01, '0.01 in/h'],
    [0.099, '0.09 in/h'],
    [0.29, '0.29 in/h'],
    [1.5, '1.50 in/h'],
  ])('rate %d reads as %s', (value, text) => {
    expect(formatRate(value)).toBe(text);
  });

  it('treats traces below the shown precision as not measurable', () => {
    expect(isMeasurable(0)).toBe(false);
    expect(isMeasurable(0.009)).toBe(false);
    expect(isMeasurable(0.01)).toBe(true);
  });

  it('rounds temperature and never prints a negative zero', () => {
    expect(formatTemp(31.6)).toBe('32°F');
    expect(formatTemp(-0.3)).toBe('0°F');
    expect(formatTemp(-12.4)).toBe('-12°F');
    expect(formatTemp(null)).toBe('—');
  });
});
