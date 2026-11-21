import { describe, expect, it } from 'vitest';
import { weatherCondition } from './weatherCodes';

describe('weatherCondition', () => {
  it.each([
    [0, 'Clear'],
    [3, 'Overcast'],
    [45, 'Fog'],
    [56, 'Freezing drizzle'],
    [63, 'Rain'],
    [66, 'Freezing rain'],
    [71, 'Light snow'],
    [75, 'Heavy snow'],
    [82, 'Violent showers'],
    [86, 'Heavy snow showers'],
    [95, 'Thunderstorm'],
    [99, 'Thunderstorm, heavy hail'],
  ])('code %d reads as %s', (code, label) => {
    expect(weatherCondition(code)).toBe(label);
  });

  it('names every code Open-Meteo documents', () => {
    const documented = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86];
    for (const code of [...documented, 95, 96, 99]) expect(weatherCondition(code)).toEqual(expect.any(String));
  });

  it('has no label for a missing or unknown code', () => {
    expect(weatherCondition(null)).toBeNull();
    expect(weatherCondition(undefined)).toBeNull();
    expect(weatherCondition(4)).toBeNull();
    expect(weatherCondition(100)).toBeNull();
  });
});
