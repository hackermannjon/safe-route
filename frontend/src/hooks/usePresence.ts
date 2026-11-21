import { useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

export interface Presence {
  /** Render it: it is open, or closed and still playing its way out. */
  mounted: boolean;
  /** Closed but still on screen; it should animate out and take no input. */
  leaving: boolean;
}

/**
 * Keeps something on screen for `exitMs` after it closes, so it can leave the way it came instead
 * of vanishing. Reopening during the exit takes it back at once.
 */
export function usePresence(open: boolean, exitMs: number): Presence {
  const still = useReducedMotion();
  const [wasOpen, setWasOpen] = useState(open);
  const [lingering, setLingering] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLingering(!open && !still);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(timer);
  }, [lingering, exitMs]);
  return { mounted: open || lingering, leaving: !open && lingering };
}
