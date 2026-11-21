import { describe, expect, it } from 'vitest';
import { isNight } from './daylight';

// Charleston, SC: sunset on 21 November 2026 is about 17:15 EST (22:15 UTC).
const CHARLESTON = [32.78, -79.93] as const;

describe('isNight', () => {
  it('is day at noon and night at midnight', () => {
    expect(isNight(...CHARLESTON, '2026-11-21T17:00:00Z')).toBe(false);
    expect(isNight(...CHARLESTON, '2026-11-22T05:00:00Z')).toBe(true);
  });

  it('turns at sunset, to within a few minutes', () => {
    expect(isNight(...CHARLESTON, '2026-11-21T22:05:00Z')).toBe(false);
    expect(isNight(...CHARLESTON, '2026-11-21T22:25:00Z')).toBe(true);
  });

  it('follows the place, not the viewer: it is already night further east at the same instant', () => {
    expect(isNight(38.72, -9.14, '2026-11-21T20:00:00Z')).toBe(true);
    expect(isNight(...CHARLESTON, '2026-11-21T20:00:00Z')).toBe(false);
  });

  it('treats an unreadable time as day', () => {
    expect(isNight(...CHARLESTON, 'not a time')).toBe(false);
  });
});
