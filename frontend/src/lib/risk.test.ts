import { describe, expect, it } from 'vitest';
import { RISK_LEVELS, RISK_META, factorLabel, riskLabel } from './risk';

describe('risk metadata', () => {
  it('orders levels best to worst, matching the API scale', () => {
    expect(RISK_LEVELS).toEqual(['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL']);
    expect(RISK_LEVELS.map((level) => RISK_META[level].order)).toEqual([0, 1, 2, 3, 4]);
    expect(RISK_LEVELS.every((level) => RISK_META[level].level === level)).toBe(true);
  });

  it('gives every level a word, a glyph and a colour token', () => {
    expect(RISK_LEVELS.map(riskLabel)).toEqual(['Low', 'Moderate', 'High', 'Severe', 'No Travel']);
    expect(RISK_LEVELS.map((l) => RISK_META[l].glyph)).toEqual(['circle', 'triangle', 'diamond', 'square', 'octagon']);
    expect(RISK_LEVELS.map((l) => RISK_META[l].token)).toEqual([
      '--risk-low',
      '--risk-moderate',
      '--risk-high',
      '--risk-severe',
      '--risk-notravel',
    ]);
    expect(RISK_META.HIGH.color).toBe('var(--risk-high)');
  });

  it('uses a distinct glyph per level so none depends on colour alone', () => {
    expect(new Set(RISK_LEVELS.map((l) => RISK_META[l].glyph)).size).toBe(RISK_LEVELS.length);
  });

  it('names each driving factor', () => {
    expect(['wind', 'rain', 'snow', 'load'].map((f) => factorLabel(f as never))).toEqual([
      'Wind',
      'Rain',
      'Snow',
      'Wind with this load',
    ]);
  });
});
