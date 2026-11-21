export type MapTheme = 'dark' | 'light';

/** Screen space covered by UI floating over the map: the sheet, panels, the search pill. */
export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const FIT_MARGIN_PX = 40;
/** MapLibre's attribution line at the bottom edge, with its margin. */
export const ATTRIBUTION_CLEARANCE_PX = 34;
/** The least map a fit keeps for the routes along each axis. */
const MIN_ROOM_PX = 80;

/**
 * Camera padding for a fit. fitBounds does nothing at all when the insets leave no room (a tall
 * sheet on a short phone), so they shrink in proportion instead.
 */
export function fitPadding(padding: MapPadding, width: number, height: number): MapPadding {
  const scale = (a: number, b: number, size: number): [number, number] => {
    const total = a + b;
    const room = Math.max(0, size - MIN_ROOM_PX);
    return total > room && total > 0 ? [(a * room) / total, (b * room) / total] : [a, b];
  };
  const [top, bottom] = scale(
    padding.top + FIT_MARGIN_PX,
    padding.bottom + ATTRIBUTION_CLEARANCE_PX + FIT_MARGIN_PX,
    height,
  );
  const [left, right] = scale(padding.left + FIT_MARGIN_PX, padding.right + FIT_MARGIN_PX, width);
  return { top, bottom, left, right };
}
