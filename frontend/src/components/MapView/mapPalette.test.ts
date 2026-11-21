import { afterEach, describe, expect, it } from 'vitest';
import { readMapPalette } from './mapPalette';

const DARK = {
  '--bg': '#071a21',
  '--surface-1': '#0c2530',
  '--ink': '#ecf3f5',
  '--ink-faint': '#62808c',
  '--accent': '#5b8cff',
};
const LIGHT = { ...DARK, '--bg': '#f3f6f7', '--surface-1': '#ffffff', '--accent': '#1f5bd8' };

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
    expect(palette).toEqual({
      casing: '#071a21',
      alternative: '#62808c',
      selected: '#5b8cff',
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
    expect(light.casing).not.toBe(dark.casing);
  });

  it('falls back to a neutral colour when a token is missing', () => {
    const palette = readMapPalette(themed({}));
    expect(palette.selected).toBe('gray');
    expect(palette.casing).toBe('gray');
  });
});
