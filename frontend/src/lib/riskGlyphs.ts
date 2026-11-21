import type { RiskGlyphId } from './risk';

/**
 * SVG path data on a 16-unit grid, shared by the inline glyphs and the map icons so both
 * draw the same shapes. Sized by eye so each reads at the same weight: a triangle needs more
 * area than a circle to look as big. Paths are filled even-odd: No Travel is an octagon with
 * a bar cut out of it, like a no-entry sign, because a plain octagon at map-dot size reads as
 * the Low circle.
 */
export const GLYPH_PATHS: Readonly<Record<RiskGlyphId, string>> = {
  circle: 'M8 2a6 6 0 1 1 0 12A6 6 0 1 1 8 2Z',
  triangle: 'M8 1.2 15.2 14.2H.8Z',
  diamond: 'M8 .8 15.2 8 8 15.2.8 8Z',
  square: 'M3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2Z',
  octagon: 'M5.1 1h5.8L15 5.1v5.8L10.9 15H5.1L1 10.9V5.1ZM4 6.8v2.4h8V6.8Z',
};
