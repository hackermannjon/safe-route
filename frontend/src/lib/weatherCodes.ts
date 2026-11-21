// Display names for the WMO weather interpretation codes Open-Meteo returns (WMO 4677, the
// subset Open-Meteo documents). Display only: risk levels come from the measured amounts.
const CONDITIONS: Readonly<Record<number, string>> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, heavy hail',
};

/** "Light snow" for 71; null when the code is missing or not one Open-Meteo uses. */
export function weatherCondition(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return CONDITIONS[code] ?? null;
}

/** The sky a code describes, for its icon. Coarser than the condition text on purpose. */
export type WeatherSky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'freezing' | 'snow' | 'thunder';

const SKY_RANGES: ReadonlyArray<readonly [WeatherSky, readonly number[]]> = [
  ['clear', [0, 1]],
  ['partly', [2]],
  ['cloudy', [3]],
  ['fog', [45, 48]],
  ['drizzle', [51, 53, 55]],
  ['freezing', [56, 57, 66, 67]],
  ['rain', [61, 63, 65, 80, 81, 82]],
  ['snow', [71, 73, 75, 77, 85, 86]],
  ['thunder', [95, 96, 99]],
];

const SKY: ReadonlyMap<number, WeatherSky> = new Map(
  SKY_RANGES.flatMap(([sky, codes]) => codes.map((code) => [code, sky] as const)),
);

/** "rain" for 63; null when the code is missing or not one Open-Meteo uses. */
export function weatherSky(code: number | null | undefined): WeatherSky | null {
  if (code === null || code === undefined) return null;
  return SKY.get(code) ?? null;
}
