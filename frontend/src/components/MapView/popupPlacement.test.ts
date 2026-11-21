import { describe, expect, it } from 'vitest';
import { popupCentered } from './popupPlacement';

const MAP = { width: 900, height: 600 };
const POPUP = { width: 260, height: 200 };

describe('popupCentered', () => {
  it('centres the point and its popup together', () => {
    expect(popupCentered(POPUP, MAP)).toEqual({ x: 450, y: 400 });
  });

  it('never pushes the point off the bottom of a short map', () => {
    expect(popupCentered(POPUP, { width: 390, height: 260 })).toEqual({ x: 195, y: 230 });
    expect(popupCentered(POPUP, { width: 390, height: 200 })).toEqual({ x: 195, y: 192 });
  });
});
