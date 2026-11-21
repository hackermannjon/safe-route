/**
 * The CSS cubic-bezier timing function as a JS easing, so a camera move can follow the same curve
 * as a CSS transition running next to it. Solves x(t) = progress by Newton's method, falling back
 * to bisection where the slope is too flat to step from.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const coord = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  const slope = (t: number, a: number, b: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2;

  const solve = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = coord(t, x1, x2) - x;
      if (Math.abs(error) < 1e-6) return t;
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-6) {
      if (coord(t, x1, x2) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return coord(solve(progress), y1, y2);
  };
}
