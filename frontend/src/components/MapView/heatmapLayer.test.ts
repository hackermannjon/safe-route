import { describe, expect, it } from 'vitest';
import { blendPixels, changedPixels } from './heatmapLayer';

const px = (...values: number[]) => Uint8ClampedArray.from(values);

describe('changedPixels', () => {
  it('lists only the pixels that differ, so steady areas are never redrawn', () => {
    const from = px(10, 20, 30, 128, 1, 2, 3, 4, 0, 0, 0, 0);
    const to = px(10, 20, 30, 128, 1, 2, 3, 5, 9, 9, 9, 9);
    expect(Array.from(changedPixels(from, to))).toEqual([4, 8]);
  });
});

describe('blendPixels', () => {
  it('leaves an unchanged pixel at its own value at every step of the fade', () => {
    const from = px(200, 100, 50, 128, 0, 0, 0, 0);
    const to = px(200, 100, 50, 128, 0, 0, 255, 255);
    const out = Uint8ClampedArray.from(to);
    const changed = changedPixels(from, to);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      blendPixels(from, to, changed, t, out);
      expect(Array.from(out.slice(0, 4))).toEqual([200, 100, 50, 128]);
    }
  });

  it('fades a cell in with its own colour instead of through black', () => {
    const from = px(0, 0, 0, 0);
    const to = px(200, 100, 50, 200);
    const out = new Uint8ClampedArray(4);
    blendPixels(from, to, changedPixels(from, to), 0.5, out);
    expect(Array.from(out)).toEqual([200, 100, 50, 100]);
  });

  it('starts at the old hour and ends at the new one', () => {
    const from = px(10, 20, 30, 100);
    const to = px(250, 200, 150, 220);
    const out = new Uint8ClampedArray(4);
    const changed = changedPixels(from, to);
    blendPixels(from, to, changed, 0, out);
    expect(Array.from(out)).toEqual([10, 20, 30, 100]);
    blendPixels(from, to, changed, 1, out);
    expect(Array.from(out)).toEqual([250, 200, 150, 220]);
  });
});
