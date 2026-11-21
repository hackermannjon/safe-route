import { describe, expect, it } from 'vitest';
import { dayMarks, nightSpans } from './forecastMarks';

// The test setup pins TZ to America/Chicago.
const SAT_2PM_CHICAGO = Date.parse('2026-11-21T20:00:00Z');

describe('dayMarks', () => {
  it('marks each local midnight in the window with the day it starts', () => {
    expect(dayMarks(SAT_2PM_CHICAGO, 48)).toEqual([
      { at: 10, label: 'Sun' },
      { at: 34, label: 'Mon' },
    ]);
  });

  it('keeps midnights on midnight across a clock change', () => {
    // 2026-11-01 02:00 CDT falls back to 01:00 CST; Saturday 31 Oct noon CDT is 17:00Z.
    const marks = dayMarks(Date.parse('2026-10-31T17:00:00Z'), 48);
    expect(marks.map((mark) => mark.label)).toEqual(['Sun', 'Mon']);
    expect(marks[1].at - marks[0].at).toBe(25);
  });

  it('has nothing to mark without a departure', () => {
    expect(dayMarks(Number.NaN, 48)).toEqual([]);
  });
});

describe('nightSpans', () => {
  const chicago = () => [41.88, -87.63] as const;

  it('finds each night in the window, with edges near sunset and sunrise', () => {
    const spans = nightSpans(SAT_2PM_CHICAGO, 48, chicago);
    expect(spans).toHaveLength(2);
    // Chicago in late November: sunset about 4:25 PM, sunrise about 6:55 AM.
    expect(spans[0].from).toBeCloseTo(2.5, 0);
    expect(spans[0].to).toBeCloseTo(17, 0);
    expect(spans[1].from).toBeCloseTo(26.5, 0);
  });

  it('closes a night still running at the end of the window', () => {
    const spans = nightSpans(Date.parse('2026-11-21T23:00:00Z'), 3, chicago);
    expect(spans).toEqual([{ from: 0, to: 3 }]);
  });
});
