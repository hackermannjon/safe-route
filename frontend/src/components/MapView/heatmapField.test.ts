import { describe, expect, it, vi } from 'vitest';
import type { RiskLevel } from '../../types/api';
import {
  FIELD_PAD_CELLS,
  colorTable,
  corridorEdge,
  extendField,
  fieldLayout,
  paintField,
  softenFringe,
} from './heatmapField';

const COLORS: Record<RiskLevel, string> = {
  LOW: '#2f9e6b',
  MODERATE: '#c99a2e',
  HIGH: '#d9702a',
  SEVERE: '#d63c3c',
  NO_TRAVEL: '#8e2a8f',
};

// Three columns, one row: the corridor covers the first two cells.
const GRID = { lat0: 40, lon0: -100, dlat: 1, dlon: 1, rows: 1, cols: 3 };
const PAD = FIELD_PAD_CELLS;

function paint(values: number[], mask = [1, 1, 0], edge: Uint8ClampedArray | null = null) {
  const layout = fieldLayout(GRID);
  const out = new Uint8ClampedArray(layout.width * layout.height * 4);
  paintField(
    layout,
    Uint8Array.from(mask),
    Float32Array.from(values),
    GRID.cols,
    colorTable('risk', { risk: COLORS, weatherLow: '#0000c8', weatherHigh: '#c80064' }),
    out,
    edge,
  );
  const cell = layout.width / (GRID.cols + 2 * PAD);
  // The grid's own row, in the middle of the padded image.
  const row = Math.floor(layout.height / 2) * layout.width;
  const pixel = (x: number) => Array.from(out.slice((row + x) * 4, (row + x) * 4 + 4));
  /** x of a point `at` cells from the grid's west edge. */
  const at = (cells: number) => Math.floor((PAD + cells) * cell);
  return { layout, pixel, at, row };
}

describe('fieldLayout', () => {
  it('covers whole cells and a clear margin, corners clockwise from the north west', () => {
    const layout = fieldLayout(GRID);
    expect(layout.corners).toEqual([
      [-100.5 - PAD, 40.5 + PAD],
      [-97.5 + PAD, 40.5 + PAD],
      [-97.5 + PAD, 39.5 - PAD],
      [-100.5 - PAD, 39.5 - PAD],
    ]);
    expect(layout.width).toBe((3 + 2 * PAD) * 12);
    expect(layout.height).toBe((1 + 2 * PAD) * 12);
  });

  it('spaces rows evenly in Mercator, so a tall grid keeps each cell under its own latitude', () => {
    const layout = fieldLayout({ lat0: 25, lon0: -100, dlat: 1, dlon: 1, rows: 25, cols: 1 });
    // The middle image row is north of the grid's middle latitude, where Mercator stretches more.
    const middle = layout.height / 2;
    const gridRow = layout.row0[middle] + layout.rowT[middle];
    expect(gridRow).toBeGreaterThan(12);
    expect(layout.row0In[middle]).toBe(1);
  });
});

describe('paintField', () => {
  it('draws each cell centre in its own level colour', () => {
    const { pixel, at } = paint([0, 4, 0]);
    expect(pixel(at(0.5)).slice(0, 3)).toEqual([0x2f, 0x9e, 0x6b]);
    expect(pixel(at(1.5)).slice(0, 3)).toEqual([0x8e, 0x2a, 0x8f]);
    // Between Low and No Travel the field steps through the levels, not a mix of the two ends.
    const known = Object.values(COLORS).map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    expect(known).toContainEqual(pixel(at(1)).slice(0, 3));
  });

  it('interpolates weather linearly, so a cell is not drawn as a flat square', () => {
    const layout = fieldLayout(GRID);
    const table = colorTable('wind', { risk: COLORS, weatherLow: '#0000c8', weatherHigh: '#c80064' });
    const out = new Uint8ClampedArray(layout.width * layout.height * 4);
    paintField(layout, Uint8Array.from([1, 1, 1]), Float32Array.from([0, 70, 0]), GRID.cols, table, out);
    const cell = layout.width / (GRID.cols + 2 * PAD);
    const row = Math.floor(layout.height / 2) * layout.width;
    const x = Math.floor((PAD + 0.5) * cell) + 3;
    const t = (x + 0.5) / cell - PAD - 0.5;
    const k = Math.round(70 * t * (255 / 70)) * 4;
    expect(out[(row + x) * 4 + 3]).toBe(table.rgba[k + 3]);
  });

  it('leaves the outside of the corridor clear and fades its edge', () => {
    const { pixel, at } = paint([1, 1, 3]);
    expect(pixel(at(2.5))[3]).toBe(0);
    expect(pixel(at(0.5))[3]).toBeGreaterThan(pixel(at(2) - 1)[3]);
  });

  it('fades out past the edge of the grid instead of stopping there', () => {
    // Every cell inside: the old image ended half a cell past the last centre at full strength.
    const { pixel, at, layout } = paint([1, 1, 1], [1, 1, 1]);
    const inside = pixel(at(2.5))[3];
    expect(inside).toBeGreaterThan(0);
    expect(pixel(at(3) + 1)[3]).toBeLessThan(inside);
    expect(pixel(at(3.5))[3]).toBe(0);
    expect(pixel(layout.width - 1)[3]).toBe(0);
    expect(pixel(0)[3]).toBe(0);
  });

  it('takes the outline from the drawn corridor when there is one', () => {
    const layout = fieldLayout(GRID);
    const edge = new Uint8ClampedArray(layout.width * layout.height);
    const { at, row } = paint([1, 1, 0]);
    const x = at(0.5);
    edge[row + x] = 255;
    edge[row + x + 1] = 51;
    const { pixel } = paint([1, 1, 0], [1, 1, 0], edge);
    expect(pixel(x)[3]).toBe(Math.round(0.5 * 255));
    expect(pixel(x + 1)[3]).toBe(Math.round(0.1 * 255));
    expect(pixel(x + 2)[3]).toBe(0);
  });
});

describe('extendField', () => {
  // A 9 x 9 grid on the equator whose corridor is the middle row; columns 3 to 5 are High.
  const grid = { lat0: 0, lon0: 0, dlat: 1, dlon: 1, rows: 9, cols: 9 };
  const mask = Uint8Array.from({ length: 81 }, (_, i) => (Math.floor(i / 9) === 4 ? 1 : 0));
  const values = Float32Array.from({ length: 81 }, (_, i) =>
    Math.floor(i / 9) === 4 && i % 9 >= 3 && i % 9 <= 5 ? 2 : 0,
  );

  it('spills a strong stretch past the corridor, keeping its level and rounding its ends', () => {
    const spill = extendField(values, mask, grid, 'risk', 3);
    const at = (row: number, col: number) => (row + 3) * 15 + col + 3;
    expect(spill.weight[at(5, 4)]).toBeGreaterThan(0.15);
    expect(spill.values[at(5, 4)]).toBeCloseTo(2, 5);
    // Fainter further out and towards the stretch's ends, so the outline closes in a curve.
    expect(spill.weight[at(6, 4)]).toBeLessThan(spill.weight[at(5, 4)]);
    expect(spill.weight[at(5, 2)]).toBeLessThan(spill.weight[at(5, 4)]);
    expect(spill.weight[at(5, 0)]).toBeLessThan(0.01);
  });

  it('leaves corridor cells to their own forecast and spills nothing from a calm frame', () => {
    const spill = extendField(values, mask, grid, 'risk', 3);
    for (let col = 0; col < 9; col++) expect(spill.weight[(4 + 3) * 15 + col + 3]).toBe(0);
    const calm = extendField(new Float32Array(81), mask, grid, 'risk', 3);
    expect(Math.max(...calm.weight)).toBe(0);
  });

  it('paints the spill past the corridor, which stays clear without it', () => {
    const layout = fieldLayout(grid, 3);
    const table = colorTable('risk', { risk: COLORS, weatherLow: '#0000c8', weatherHigh: '#c80064' });
    const draw = (withSpill: boolean) => {
      const out = new Uint8ClampedArray(layout.width * layout.height * 4);
      const spill = withSpill ? extendField(values, mask, grid, 'risk', 3) : null;
      paintField(layout, mask, values, grid.cols, table, out, null, spill);
      return out;
    };
    const cell = layout.width / 15;
    // A pixel one and a half rows north of the corridor, above the High stretch.
    const p = (Math.floor((3 + 9 - 1 - 5.5) * cell) * layout.width + Math.floor((3 + 4.5) * cell)) * 4;
    expect(draw(false)[p + 3]).toBe(0);
    const spilled = draw(true);
    expect(spilled[p + 3]).toBeGreaterThan(0);
    expect(Array.from(spilled.slice(p, p + 3))).toEqual([0xd9, 0x70, 0x2a]);
  });
});

describe('softenFringe', () => {
  it('spreads a wet block into its dry neighbours without lowering it', () => {
    // One row: two wet cells, then dry ones, the last outside the corridor.
    const values = Float32Array.from([0.8, 0.8, 0, 0, 0.5]);
    const mask = Uint8Array.from([1, 1, 1, 1, 0]);
    const soft = Array.from(softenFringe(values, mask, 1, 5));
    expect(soft[0]).toBeCloseTo(0.8, 5);
    expect(soft[1]).toBeCloseTo(0.8, 5);
    expect(soft[2]).toBeCloseTo(0.2, 5);
    // Cells outside the corridor lend nothing.
    expect(soft[3]).toBe(0);
  });
});

describe('corridorEdge', () => {
  it('falls back to the cell outline without a canvas or routes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const layout = fieldLayout(GRID);
    expect(corridorEdge(layout, [])).toBeNull();
    expect(
      corridorEdge(layout, [
        [
          [-100, 40],
          [-99, 40],
        ],
      ]),
    ).toBeNull();
  });
});
