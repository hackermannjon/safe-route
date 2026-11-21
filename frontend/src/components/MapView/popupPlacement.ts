// The checkpoint popup always opens above its point, centred on it, so where it lands follows
// from where the point is on screen. These helpers say where the point must be for it to fit.

export interface Size {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Room left between the popup and the map's edges. */
export const POPUP_MARGIN_PX = 8;

function clamp(value: number, min: number, max: number): number {
  // When the map is too small for the popup, keep the point itself on screen.
  return Math.min(Math.max(value, min), max);
}

function bounds(popup: Size, map: Size, margin: number) {
  const halfWidth = popup.width / 2;
  return {
    minX: margin + halfWidth,
    maxX: Math.max(margin + halfWidth, map.width - margin - halfWidth),
    minY: margin + popup.height,
    maxY: map.height - margin,
  };
}

/**
 * Where the point should move so the popup above it is fully inside the map, moving as little
 * as possible; null when it already fits, so a dot the driver just tapped stays put.
 */
export function popupFit(point: ScreenPoint, popup: Size, map: Size, margin = POPUP_MARGIN_PX): ScreenPoint | null {
  const b = bounds(popup, map, margin);
  const target = { x: clamp(point.x, b.minX, b.maxX), y: clamp(point.y, b.minY, b.maxY) };
  if (map.width < popup.width + 2 * margin) target.x = map.width / 2;
  return Math.abs(target.x - point.x) < 1 && Math.abs(target.y - point.y) < 1 ? null : target;
}

/** Where to put a point picked from the list: the point and its popup centred as one block. */
export function popupCentered(popup: Size, map: Size, margin = POPUP_MARGIN_PX): ScreenPoint {
  const b = bounds(popup, map, margin);
  return { x: map.width / 2, y: clamp(map.height / 2 + popup.height / 2, b.minY, b.maxY) };
}
