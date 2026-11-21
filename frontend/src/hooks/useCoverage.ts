import { useLayoutEffect, useState } from 'react';

/**
 * How far an element floating over the map reaches in from one edge of the viewport: from the
 * top down to its bottom, or from the bottom up to its top. Measured rather than assumed,
 * because a card's height follows its copy, the font and the phone's width. Pass the element
 * from a callback ref so one rendered conditionally is picked up when it mounts. A card that
 * slides to a new place is measured again where its transition ends.
 */
export function useCoverage(element: HTMLElement | null, edge: 'top' | 'bottom', fallback: number): number {
  const [coverage, setCoverage] = useState(fallback);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = Math.max(0, Math.round(edge === 'top' ? box.bottom : window.innerHeight - box.top));
      setCoverage((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    element.addEventListener('transitionend', measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', measure);
      element.removeEventListener('transitionend', measure);
      observer?.disconnect();
    };
  }, [element, edge]);

  return element ? coverage : 0;
}
