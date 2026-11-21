import { describe, expect, it } from 'vitest';
import {
  MAX_CARGO_LB,
  cargoError,
  departureBounds,
  departureError,
  localInputToIso,
  nextWholeHour,
  parseLocalInput,
  toLocalInputValue,
} from '../formModel';

// Tests run in America/Chicago (see vite.config.ts).
const NOW = new Date('2026-11-21T13:30:00Z'); // Sat 7:30 AM CST

describe('departure input values', () => {
  it('round-trips the datetime-local format in the local zone', () => {
    expect(toLocalInputValue(NOW)).toBe('2026-11-21T07:30');
    expect(parseLocalInput('2026-11-21T07:30')?.getTime()).toBe(NOW.getTime());
  });

  it('rejects text that is not a real local time', () => {
    expect(parseLocalInput('')).toBeNull();
    expect(parseLocalInput('2026-11-21')).toBeNull();
    expect(parseLocalInput('2026-02-30T08:00')).toBeNull();
  });

  it('sends the wall-clock time with the offset in force at that moment', () => {
    expect(localInputToIso('2026-11-21T08:00')).toBe('2026-11-21T08:00:00-06:00');
    // Daylight saving time is still on in late October.
    expect(localInputToIso('2026-10-30T08:00')).toBe('2026-10-30T08:00:00-05:00');
    expect(localInputToIso('nope')).toBeNull();
  });

  it('defaults to the next whole hour', () => {
    expect(toLocalInputValue(nextWholeHour(NOW))).toBe('2026-11-21T08:00');
    expect(toLocalInputValue(nextWholeHour(new Date('2026-11-22T05:59:00Z')))).toBe('2026-11-22T00:00');
  });

  it('bounds the picker to the window the server accepts', () => {
    expect(departureBounds(NOW)).toEqual({ min: '2026-11-21T06:30', max: '2026-11-28T07:30' });
  });
});

describe('departureError', () => {
  it.each([
    ['2026-11-21T06:31', null],
    ['2026-11-21T06:29', 'Departure cannot be more than 1 hour in the past.'],
    ['2026-11-28T07:30', null],
    ['2026-11-28T07:31', 'Departure must be within the next 7 days (weather forecast range).'],
    ['', 'Choose a departure date and time.'],
  ])('%s -> %s', (value, message) => {
    expect(departureError(value, NOW)).toBe(message);
  });
});

describe('cargoError', () => {
  it.each([0, 1, 30_000, 42_000, MAX_CARGO_LB])('accepts %d lb', (value) => {
    expect(cargoError(value)).toBeNull();
  });

  it('asks for a weight when the field is empty', () => {
    expect(cargoError(null)).toBe('Enter the cargo weight.');
    expect(cargoError(Number.NaN)).toBe('Enter the cargo weight.');
  });

  it('refuses weights outside 0 to 80,000 lb with the server wording', () => {
    expect(cargoError(80_001)).toBe('Cargo weight cannot exceed 80,000 lb.');
    expect(cargoError(-1)).toBe('Cargo weight cannot be negative.');
  });
});
