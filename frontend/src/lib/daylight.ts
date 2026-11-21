const RAD = Math.PI / 180;

/** Sun's centre this far below the horizon is sunset, refraction and its radius included. */
const HORIZON_DEG = -0.833;

/**
 * Whether the sun is down at a place and instant, so a clear sky can show a moon. Uses the
 * NOAA low-precision solar position, good to a few minutes, which is plenty for an icon.
 */
export function isNight(lat: number, lon: number, iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const date = new Date(t);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((t - startOfYear) / 86_400_000);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const year = (2 * Math.PI * (dayOfYear + (hours - 12) / 24)) / 365;

  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(year) -
      0.032077 * Math.sin(year) -
      0.014615 * Math.cos(2 * year) -
      0.040849 * Math.sin(2 * year));
  const declination =
    0.006918 -
    0.399912 * Math.cos(year) +
    0.070257 * Math.sin(year) -
    0.006758 * Math.cos(2 * year) +
    0.000907 * Math.sin(2 * year) -
    0.002697 * Math.cos(3 * year) +
    0.00148 * Math.sin(3 * year);

  const solarMinutes = hours * 60 + equationOfTime + 4 * lon;
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const phi = lat * RAD;
  const sinElevation =
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(sinElevation) < HORIZON_DEG * RAD;
}
