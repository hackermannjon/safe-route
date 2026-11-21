import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_CLEARANCE_PX, fitPadding } from './camera';

describe('fitPadding', () => {
  it('adds a margin and room for the attribution to what covers the map', () => {
    expect(fitPadding({ top: 80, right: 0, bottom: 144, left: 0 }, 390, 844)).toEqual({
      top: 120,
      right: 40,
      bottom: 144 + ATTRIBUTION_CLEARANCE_PX + 40,
      left: 40,
    });
  });

  it('shrinks the insets in proportion when they leave no room for the routes', () => {
    const padding = fitPadding({ top: 80, right: 0, bottom: 700, left: 0 }, 390, 640);
    expect(padding.top + padding.bottom).toBeCloseTo(640 - 80);
    expect(padding.bottom / padding.top).toBeCloseTo((700 + ATTRIBUTION_CLEARANCE_PX + 40) / 120);
  });
});
