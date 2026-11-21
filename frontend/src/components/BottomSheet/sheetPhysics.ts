export type Snap = 'peek' | 'half' | 'full';

/** Mirrors --sheet-move in BottomSheet.module.css; the map eases its camera over the same time. */
export const SHEET_MOVE_MS = 320;
/** The sheet's release curve, cubic-bezier(0.2, 0.8, 0.2, 1), for anything that moves with it. */
export const SHEET_EASING = [0.2, 0.8, 0.2, 1] as const;

/** How far a finger past an end can stretch the sheet, at most. */
const STRETCH_PX = 80;
/** Velocities above this, in px/ms, carry the sheet on to the next snap whatever the distance. */
export const FLICK_PX_PER_MS = 0.5;
/** A release keeps moving about this long at its speed before the nearest snap is picked. */
const PROJECT_MS = 160;

/**
 * Past either end the sheet follows the finger with growing resistance instead of stopping dead,
 * the way a native sheet does, and never stretches more than STRETCH_PX.
 */
export function rubberBand(offset: number, min: number, max: number): number {
  const stretch = (over: number) => (STRETCH_PX * over) / (STRETCH_PX + over);
  if (offset < min) return min - stretch(min - offset);
  if (offset > max) return max + stretch(offset - max);
  return offset;
}

/**
 * The snap a released sheet settles on. A flick goes to the next snap in its direction from where
 * the finger let go; a slow release goes to the snap nearest where its momentum would carry it.
 */
export function releaseTarget(
  offset: number,
  velocity: number,
  snaps: readonly { snap: Snap; offset: number }[],
): Snap {
  if (Math.abs(velocity) > FLICK_PX_PER_MS) {
    const down = velocity > 0;
    const ahead = snaps
      .filter((s) => (down ? s.offset > offset : s.offset < offset))
      .sort((a, b) => (down ? a.offset - b.offset : b.offset - a.offset));
    if (ahead[0]) return ahead[0].snap;
  }
  const projected = offset + velocity * PROJECT_MS;
  return snaps.reduce((best, s) => (Math.abs(s.offset - projected) < Math.abs(best.offset - projected) ? s : best))
    .snap;
}

/** Recent moves count most, so one jittery event at release does not decide the snap. */
export function smoothVelocity(previous: number, sample: number): number {
  return previous * 0.3 + sample * 0.7;
}
