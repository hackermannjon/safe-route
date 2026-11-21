import type { RiskFactor, RiskLevel } from '../types/api';

// Display metadata only. Levels are classified by the API; the client never derives one
// from weather values.

export type RiskGlyphId = 'circle' | 'triangle' | 'diamond' | 'square' | 'octagon';

export interface RiskMeta {
  level: RiskLevel;
  label: string;
  /** 0 = Low ... 4 = No Travel, the API's numeric scale. */
  order: number;
  /** CSS custom property, for code that needs the resolved value (the map). */
  token: `--risk-${string}`;
  /** Ready for a style attribute. */
  color: string;
  /** A distinct shape per level, so no level depends on colour alone. */
  glyph: RiskGlyphId;
}

function meta(level: RiskLevel, label: string, order: number, slug: string, glyph: RiskGlyphId): RiskMeta {
  const token = `--risk-${slug}` as const;
  return { level, label, order, token, color: `var(${token})`, glyph };
}

export const RISK_META: Readonly<Record<RiskLevel, RiskMeta>> = {
  LOW: meta('LOW', 'Low', 0, 'low', 'circle'),
  MODERATE: meta('MODERATE', 'Moderate', 1, 'moderate', 'triangle'),
  HIGH: meta('HIGH', 'High', 2, 'high', 'diamond'),
  SEVERE: meta('SEVERE', 'Severe', 3, 'severe', 'square'),
  NO_TRAVEL: meta('NO_TRAVEL', 'No Travel', 4, 'notravel', 'octagon'),
};

/** Best first, worst last: the order of legends and bars. */
export const RISK_LEVELS: readonly RiskLevel[] = ['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL'];

export function riskLabel(level: RiskLevel): string {
  return RISK_META[level].label;
}

const FACTOR_LABEL: Readonly<Record<RiskFactor, string>> = {
  wind: 'Wind',
  rain: 'Rain',
  snow: 'Snow',
  load: 'Wind with this load',
};

/** What set the level, in a driver's words. */
export function factorLabel(factor: RiskFactor): string {
  return FACTOR_LABEL[factor];
}
