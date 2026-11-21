import type { WeatherSky } from '../../lib/weatherCodes';
import type { WeatherIconName } from './WeatherIcon';

/** The icon for a sky, with the moon in place of the sun after dark. */
export function skyIcon(sky: WeatherSky, night: boolean): WeatherIconName {
  if (!night) return sky;
  if (sky === 'clear') return 'clear-night';
  if (sky === 'partly') return 'partly-night';
  return sky;
}
