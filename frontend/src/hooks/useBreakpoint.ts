import { useMediaQuery } from './useMediaQuery';

// From here up a side panel fits beside a usable map; below it the map takes the screen. A
// narrow desktop window gets the panel and a mouse-friendly single scroll, not the sheet.
export const DESKTOP_MIN_WIDTH = 768;

export type Breakpoint = 'mobile' | 'desktop';

export function useBreakpoint(): Breakpoint {
  return useMediaQuery(`(min-width: ${DESKTOP_MIN_WIDTH}px)`) ? 'desktop' : 'mobile';
}
