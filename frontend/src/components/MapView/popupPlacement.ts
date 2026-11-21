// The checkpoint popup always opens above its point, centred on it, so where it lands follows
// from where the point is on screen.

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

/** Where to put a picked point: the point and its popup centred as one block. */
export function popupCentered(popup: Size, map: Size, margin = POPUP_MARGIN_PX): ScreenPoint {
  return { x: map.width / 2, y: clamp(map.height / 2 + popup.height / 2, margin + popup.height, map.height - margin) };
}
