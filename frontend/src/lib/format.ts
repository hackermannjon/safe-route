const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "1,017 mi" */
export function formatMiles(miles: number): string {
  return `${integer.format(miles)} mi`;
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
