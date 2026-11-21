/**
 * Everything the map paints, resolved from the design tokens. WebGL paint needs concrete
 * colours, so the map reads them from the stylesheet instead of keeping a second palette.
 */
export interface MapPalette {
  /** Outline around route lines and dots, so they read on the basemap: the page background. */
  casing: string;
  /** Routes that are not selected. */
  alternative: string;
  /** The selected route. */
  selected: string;
}

/** Only when a token is missing (a test without the stylesheet): visible on either basemap. */
const MISSING = 'gray';

export function readMapPalette(element: Element = document.documentElement): MapPalette {
  const style = getComputedStyle(element);
  const read = (token: string) => style.getPropertyValue(token).trim() || MISSING;
  return {
    casing: read('--bg'),
    alternative: read('--ink-faint'),
    selected: read('--accent'),
  };
}
