import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { RISK_LEVELS, RISK_META } from '../../lib/risk';
import { GLYPH_PATHS } from '../../lib/riskGlyphs';
import type { RiskLevel } from '../../types/api';

export type RiskColors = Record<RiskLevel, string>;

/**
 * Everything the map paints, resolved from the design tokens. WebGL paint needs concrete
 * colours, so the map reads them from the stylesheet instead of keeping a second palette.
 */
export interface MapPalette {
  risk: RiskColors;
  /** Outline around route lines and glyphs, so they read on the basemap: the page background. */
  casing: string;
  /** Routes that are not selected. */
  alternative: string;
  /** The checkpoint picked in the list or on the map. */
  focus: string;
  /** Fill of the origin ring and outline of the destination disc, and the reverse. */
  ink: string;
  surface: string;
  /** Anything with an unknown level, so a bad value never reads as Low. */
  unknown: string;
}

/** Only when a token is missing (a test without the stylesheet): visible, never mistaken for a level. */
const MISSING = 'gray';

export function readMapPalette(element: Element = document.documentElement): MapPalette {
  const style = getComputedStyle(element);
  const read = (token: string) => style.getPropertyValue(token).trim() || MISSING;
  return {
    risk: Object.fromEntries(RISK_LEVELS.map((level) => [level, read(RISK_META[level].token)])) as RiskColors,
    casing: read('--bg'),
    alternative: read('--ink-faint'),
    focus: read('--accent'),
    ink: read('--ink'),
    surface: read('--surface-1'),
    unknown: read('--ink-faint'),
  };
}

/** `match` on a feature's `level` property. */
export function riskColorExpression(colors: RiskColors, unknown: string): ExpressionSpecification {
  const pairs = RISK_LEVELS.flatMap((level) => [level, colors[level]]);
  return ['match', ['get', 'level'], ...pairs, unknown] as unknown as ExpressionSpecification;
}

export const GLYPH_IMAGE_PREFIX = 'risk-glyph-';
export const glyphImageId = (level: RiskLevel) => `${GLYPH_IMAGE_PREFIX}${level}`;

/** Drawn at 2x and shown at this size in CSS pixels at full zoom. */
export const GLYPH_ICON_PX = 18;
const PIXEL_RATIO = 2;

/**
 * One icon per level: its glyph in its colour with an outline in the casing colour, so checkpoint
 * dots read on either basemap and are told apart by shape as well as colour. A theme change
 * redraws them.
 */
export function addGlyphImages(map: MapLibreMap, palette: MapPalette): void {
  const side = GLYPH_ICON_PX * PIXEL_RATIO;
  for (const level of RISK_LEVELS) {
    const id = glyphImageId(level);
    if (map.hasImage(id)) map.removeImage(id);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const path = new Path2D(GLYPH_PATHS[RISK_META[level].glyph]);
    // 16-unit glyph inset by the outline so the stroke is not clipped at the canvas edge.
    const inset = 2.5;
    const scale = (side - inset * 2 * PIXEL_RATIO) / 16;
    ctx.translate(inset * PIXEL_RATIO, inset * PIXEL_RATIO);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineWidth = (2.5 * PIXEL_RATIO) / scale;
    ctx.strokeStyle = palette.casing;
    ctx.stroke(path);
    ctx.fillStyle = palette.risk[level];
    ctx.fill(path, 'evenodd');
    map.addImage(id, ctx.getImageData(0, 0, side, side), { pixelRatio: PIXEL_RATIO });
  }
}
