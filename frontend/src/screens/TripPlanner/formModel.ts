import type { SpacingMi } from '../../types/api';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Mirrors the server: a trip already under way may start up to an hour ago. */
export const DEPARTURE_GRACE_MS = HOUR_MS;
/** Mirrors the server: forecasts reach about a week ahead. */
export const DEPARTURE_HORIZON_MS = 7 * DAY_MS;

export const SPACING_OPTIONS: ReadonlyArray<{ value: SpacingMi; label: string }> = [
  { value: 10, label: '10 mi' },
  { value: 25, label: '25 mi' },
  { value: 50, label: '50 mi' },
];
export const DEFAULT_SPACING: SpacingMi = 25;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in the browser's zone, the value format of `<input type="datetime-local">`. */
export function toLocalInputValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function parseLocalInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  // Date rolls "02-30" over into March; a value that does not round-trip was not a real time.
  return toLocalInputValue(date) === value ? date : null;
}

/**
 * Keeps the wall-clock time the driver typed and adds the zone's offset at that moment
 * (DST-aware), instead of converting to UTC, so the request reads like the form did.
 */
export function localInputToIso(value: string): string | null {
  const date = parseLocalInput(value);
  if (!date) return null;
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${value}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function nextWholeHour(now: Date): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

/** Bounds for the native picker; the submit-time check below is what actually guards. */
export function departureBounds(now: Date): { min: string; max: string } {
  return {
    min: toLocalInputValue(new Date(now.getTime() - DEPARTURE_GRACE_MS)),
    max: toLocalInputValue(new Date(now.getTime() + DEPARTURE_HORIZON_MS)),
  };
}

/** Same rule and wording as the server, so the driver sees one message either way. */
export function departureError(value: string, now: Date): string | null {
  const departure = parseLocalInput(value);
  if (!departure) return 'Choose a departure date and time.';
  if (departure.getTime() < now.getTime() - DEPARTURE_GRACE_MS) {
    return 'Departure cannot be more than 1 hour in the past.';
  }
  if (departure.getTime() > now.getTime() + DEPARTURE_HORIZON_MS) {
    return 'Departure must be within the next 7 days (weather forecast range).';
  }
  return null;
}

/** "CST" for the browser's zone at that instant, or a GMT offset where Intl has no short name. */
export function zoneName(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(at);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'local time';
}
