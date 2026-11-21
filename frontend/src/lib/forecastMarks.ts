import { isNight } from './daylight';

/** Hours after departure; fractions place a mark between whole hours. */
export interface DayMark {
  at: number;
  /** Short weekday of the day that starts there, e.g. "Sun". */
  label: string;
}

export interface NightSpan {
  from: number;
  to: number;
}

const HOUR_MS = 3_600_000;
/** Night edges are found to a quarter hour: finer than a slider step, and cheap. */
const SAMPLES_PER_HOUR = 4;

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

/** Local midnights between departure and `maxHour` later, where the slider starts a new day. */
export function dayMarks(departMs: number, maxHour: number): DayMark[] {
  if (!Number.isFinite(departMs)) return [];
  const marks: DayMark[] = [];
  const day = new Date(departMs);
  day.setHours(24, 0, 0, 0);
  for (; day.getTime() < departMs + maxHour * HOUR_MS; day.setDate(day.getDate() + 1)) {
    marks.push({ at: (day.getTime() - departMs) / HOUR_MS, label: weekday.format(day) });
    // setDate keeps the wall-clock hour, so a DST change cannot drift the next mark off midnight.
    day.setHours(0, 0, 0, 0);
  }
  return marks;
}

/**
 * Stretches of the forecast window when it is dark where the truck is at that time; after
 * arrival, where it arrived. `placeAt` gives [lat, lon] for a time.
 */
export function nightSpans(
  departMs: number,
  maxHour: number,
  placeAt: (atMs: number) => readonly [number, number],
): NightSpan[] {
  if (!Number.isFinite(departMs)) return [];
  const spans: NightSpan[] = [];
  let from: number | null = null;
  const steps = maxHour * SAMPLES_PER_HOUR;
  for (let i = 0; i <= steps; i++) {
    const hour = i / SAMPLES_PER_HOUR;
    const atMs = departMs + hour * HOUR_MS;
    const [lat, lon] = placeAt(atMs);
    const dark = isNight(lat, lon, new Date(atMs).toISOString());
    if (dark && from === null) from = hour;
    if (!dark && from !== null) {
      spans.push({ from, to: hour });
      from = null;
    }
  }
  if (from !== null) spans.push({ from, to: maxHour });
  return spans;
}
