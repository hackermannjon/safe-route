import { describe, expect, it } from 'vitest';
import { formatDuration, formatEta, formatMilepost, formatMiles } from './format';

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
