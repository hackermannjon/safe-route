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

// Readings are truncated, not rounded, so a value just under a round threshold (24.8 mph)
// never reads as the threshold itself.

/** "12 mph" */
export function formatWind(mph: number): string {
  return Number.isFinite(mph) ? `${integer.format(Math.trunc(mph))} mph` : '—';
}

/** "0.12 in/h", for rain or snow. A trace below the shown precision reads "< 0.01 in/h". */
export function formatRate(inchesPerHour: number): string {
  if (!Number.isFinite(inchesPerHour)) return '—';
  if (inchesPerHour <= 0) return '0 in/h';
  if (inchesPerHour < 0.01) return '< 0.01 in/h';
  // The epsilon keeps 0.29 * 100 (28.999999999999996) from truncating to 0.28.
  return `${(Math.trunc(inchesPerHour * 100 + 1e-9) / 100).toFixed(2)} in/h`;
}

/** Whether a rain or snow rate shows as a number at all, so a summary can leave out traces. */
export function isMeasurable(inchesPerHour: number): boolean {
  return Number.isFinite(inchesPerHour) && inchesPerHour >= 0.01;
}

/** "31°F" */
export function formatTemp(fahrenheit: number | null): string {
  if (fahrenheit === null || !Number.isFinite(fahrenheit)) return '—';
  // Math.round(-0.3) is -0, which Intl prints as "-0".
  const rounded = Math.round(fahrenheit) || 0;
  return `${integer.format(rounded)}°F`;
}
