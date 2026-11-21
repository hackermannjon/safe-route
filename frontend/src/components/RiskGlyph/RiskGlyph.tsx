import type { CSSProperties } from 'react';
import { RISK_META } from '../../lib/risk';
import { GLYPH_PATHS } from '../../lib/riskGlyphs';
import type { RiskLevel } from '../../types/api';

export interface RiskGlyphProps {
  level: RiskLevel;
  /** Pixel size of the square box. */
  size?: number;
  /** Gives the glyph an accessible name when no word sits next to it. */
  title?: string;
  className?: string;
}

export function RiskGlyph({ level, size = 14, title, className }: RiskGlyphProps) {
  const meta = RISK_META[level];
  const style: CSSProperties = { flex: 'none', color: meta.color };
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      style={style}
      focusable="false"
      data-glyph={meta.glyph}
      {...a11y}
    >
      <path d={GLYPH_PATHS[meta.glyph]} fillRule="evenodd" />
    </svg>
  );
}
