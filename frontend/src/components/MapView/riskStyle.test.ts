import { afterEach, describe, expect, it } from 'vitest';
import { readMapPalette } from './riskStyle';

const DARK = {
  '--bg': '#071a21',
  '--surface-1': '#0c2530',
  '--ink': '#ecf3f5',
  '--ink-faint': '#62808c',
  '--accent': '#5b8cff',
  '--risk-low': '#3fbf7f',
  '--risk-moderate': '#f2c94c',
  '--risk-high': '#f2994a',
  '--risk-severe': '#eb5757',
  '--risk-notravel': '#d65bd0',
};
const LIGHT = { ...DARK, '--bg': '#f3f6f7', '--surface-1': '#ffffff', '--accent': '#1f5bd8', '--risk-low': '#1a7f50' };

function themed(tokens: Record<string, string>): HTMLElement {
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(tokens)) element.style.setProperty(name, value);
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('readMapPalette', () => {
  it('takes every map colour from the design tokens', () => {
    const palette = readMapPalette(themed(DARK));
    expect(palette.risk).toEqual({
      LOW: '#3fbf7f',
      MODERATE: '#f2c94c',
      HIGH: '#f2994a',
      SEVERE: '#eb5757',
      NO_TRAVEL: '#d65bd0',
    });
    expect(palette).toMatchObject({
      casing: '#071a21',
      alternative: '#62808c',
      focus: '#5b8cff',
      ink: '#ecf3f5',
      surface: '#0c2530',
    });
  });

  it('follows the theme the tokens are in', () => {
    const dark = readMapPalette(themed(DARK));
    const light = readMapPalette(themed(LIGHT));
    expect(light.casing).toBe('#f3f6f7');
    expect(light.focus).toBe('#1f5bd8');
    expect(light.risk.LOW).toBe('#1a7f50');
    expect(light.casing).not.toBe(dark.casing);
  });

  it('falls back to a neutral colour, never a risk colour, when a token is missing', () => {
    const palette = readMapPalette(themed({}));
    expect(palette.risk.LOW).toBe('gray');
    expect(palette.unknown).toBe('gray');
  });
});
