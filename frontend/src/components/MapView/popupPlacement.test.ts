import { describe, expect, it } from 'vitest';
import { popupCentered, popupFit } from './popupPlacement';

const MAP = { width: 900, height: 600 };
const POPUP = { width: 260, height: 200 };

describe('popupFit', () => {
  it('leaves a point alone when its popup already fits', () => {
    expect(popupFit({ x: 450, y: 400 }, POPUP, MAP)).toBeNull();
    // Exactly on the edge of the room still fits.
    expect(popupFit({ x: 138, y: 208 }, POPUP, MAP)).toBeNull();
  });

  it('moves a point near the top down just enough for the popup above it', () => {
    expect(popupFit({ x: 450, y: 50 }, POPUP, MAP)).toEqual({ x: 450, y: 208 });
  });

  it('moves a point near a side edge inwards', () => {
    expect(popupFit({ x: 20, y: 400 }, POPUP, MAP)).toEqual({ x: 138, y: 400 });
    expect(popupFit({ x: 890, y: 400 }, POPUP, MAP)).toEqual({ x: 762, y: 400 });
  });

  it('brings a point below the map back above the bottom edge', () => {
    expect(popupFit({ x: 450, y: 700 }, POPUP, MAP)).toEqual({ x: 450, y: 592 });
  });

  it('keeps the point visible on a map too small for the popup', () => {
    const tiny = { width: 240, height: 180 };
    expect(popupFit({ x: 10, y: 10 }, POPUP, tiny)).toEqual({ x: 120, y: 172 });
  });
});

describe('popupCentered', () => {
  it('centres the point and its popup together', () => {
    expect(popupCentered(POPUP, MAP)).toEqual({ x: 450, y: 400 });
  });

  it('never pushes the point off the bottom of a short map', () => {
    expect(popupCentered(POPUP, { width: 390, height: 260 })).toEqual({ x: 195, y: 230 });
    expect(popupCentered(POPUP, { width: 390, height: 200 })).toEqual({ x: 195, y: 192 });
  });
});
