import { describe, expect, it } from 'vitest';
import { releaseTarget, rubberBand, smoothVelocity } from './sheetPhysics';

const SNAPS = [
  { snap: 'full', offset: 0 },
  { snap: 'half', offset: 300 },
  { snap: 'peek', offset: 560 },
] as const;

describe('rubberBand', () => {
  it('follows the finger between the ends', () => {
    expect(rubberBand(120, 0, 560)).toBe(120);
  });

  it('resists more the further it is pulled past an end, and never passes the stretch limit', () => {
    const first = 0 - rubberBand(-40, 0, 560);
    const second = rubberBand(-80, 0, 560) - rubberBand(-40, 0, 560);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(40);
    expect(-second).toBeLessThan(first);
    expect(rubberBand(10_000, 0, 560)).toBeLessThan(560 + 80);
  });
});

describe('releaseTarget', () => {
  it('settles a slow release on the nearest snap', () => {
    expect(releaseTarget(380, 0, SNAPS)).toBe('half');
    expect(releaseTarget(480, 0, SNAPS)).toBe('peek');
  });

  it('carries a slow release as far as its momentum would take it', () => {
    expect(releaseTarget(380, 0.45, SNAPS)).toBe('peek');
  });

  it('sends a flick to the next snap in its direction, however short the drag', () => {
    expect(releaseTarget(290, 1.2, SNAPS)).toBe('half');
    expect(releaseTarget(310, 1.2, SNAPS)).toBe('peek');
    expect(releaseTarget(280, -1.2, SNAPS)).toBe('full');
  });

  it('stays at the end a flick points past', () => {
    expect(releaseTarget(-20, -2, SNAPS)).toBe('full');
  });
});

describe('smoothVelocity', () => {
  it('leans on the latest sample', () => {
    expect(smoothVelocity(0, 1)).toBeCloseTo(0.7);
  });
});
