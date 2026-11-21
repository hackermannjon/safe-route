const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "1,017 mi" */
export function formatMiles(miles: number): string {
  return `${integer.format(miles)} mi`;
}

/** "Mile 1,000": a position along the route rather than a distance. */
export function formatMilepost(mile: number): string {
  return `Mile ${integer.format(mile)}`;
}

/** "15 h 45 min". Minutes are truncated so the total never reads longer than the trip. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  if (totalMinutes === 0) return seconds > 0 ? '< 1 min' : '0 min';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });
    clockFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * "Sat 8:00 AM" in the driver's zone unless `timeZone` says otherwise. Built from parts
 * because ICU puts a narrow no-break space before AM/PM, which some fonts render oddly.
 */
export function formatEta(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = clockFormatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
}
