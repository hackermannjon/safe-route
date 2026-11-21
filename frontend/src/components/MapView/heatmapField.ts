import {
  METRIC_META,
  RISK_FIELD_ALPHA,
  rampColor,
  type Rgb,
  type HeatmapData,
  type HeatmapGrid,
  type HeatmapMetric,
} from '../../lib/heatmap';
import { RISK_LEVELS } from '../../lib/risk';
import type { MapPalette } from './riskStyle';

// Draws one forecast hour as a smooth image. Values are interpolated between cell centres and
// only then coloured, so a ramp never blends two unrelated colours. The interpolation is
// bilinear: it passes through every cell's own value and never overshoots, so a No Travel cell
// is never drawn milder or a calm one worse. Risk eases the weights so band outlines come out
// rounded rather than as diamonds; weather keeps them linear, because easing flattens each cell
// into a square plateau that shows on a continuous ramp. Outside the corridor there is no
// forecast; only the stronger areas spill a little past it (see extendField), so they end in a
// rounded outline instead of being cut along the corridor's edge.

export type Corners = [[number, number], [number, number], [number, number], [number, number]];

export interface FieldLayout {
  width: number;
  height: number;
  /** Top left, top right, bottom right, bottom left, as [lon, lat]: MapLibre's image corners. */
  corners: Corners;
  /**
   * Per image row: the two grid rows it falls between and the weight of the upper one. Rows past
   * the grid's edge are clamped onto it, and row0In/row1In say they are not real cells.
   */
  row0: Int32Array;
  row1: Int32Array;
  rowT: Float32Array;
  row0In: Uint8Array;
  row1In: Uint8Array;
  col0: Int32Array;
  col1: Int32Array;
  colT: Float32Array;
  col0In: Uint8Array;
  col1In: Uint8Array;
  /** Per image row and column, the position in grid cells (fractional, may lie past the grid). */
  rowPos: Float32Array;
  colPos: Float32Array;
  /** The image's extent in Web Mercator units (radians): west, east, north, south. */
  mercator: { x0: number; x1: number; y0: number; y1: number };
}

/** Long side of the image. The GPU smooths it further when the map is zoomed past it. */
const MAX_SIDE_PX = 512;
const MIN_CELL_PX = 3;
const MAX_CELL_PX = 12;
/**
 * Cells of clear margin around the grid. The field fades out over the cell past its last one,
 * so the image must reach that far; stopping at the grid's edge cut a rain band off straight.
 */
export const FIELD_PAD_CELLS = 2;
const RAD = Math.PI / 180;

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const latFromMercatorY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

function axis(size: number, cells: number, positionAt: (i: number) => number) {
  const pos = new Float32Array(size);
  const lo = new Int32Array(size);
  const hi = new Int32Array(size);
  const t = new Float32Array(size);
  const loIn = new Uint8Array(size);
  const hiIn = new Uint8Array(size);
  const inGrid = (cell: number) => (cell >= 0 && cell < cells ? 1 : 0);
  const clamp = (cell: number) => Math.min(cells - 1, Math.max(0, cell));
  for (let i = 0; i < size; i++) {
    const p = positionAt(i);
    pos[i] = p;
    const below = Math.floor(p);
    loIn[i] = inGrid(below);
    hiIn[i] = inGrid(below + 1);
    lo[i] = clamp(below);
    hi[i] = clamp(below + 1);
    t[i] = p - below;
  }
  return [lo, hi, t, loIn, hiIn, pos] as const;
}

export function fieldLayout(grid: HeatmapGrid, pad = FIELD_PAD_CELLS): FieldLayout {
  const { lat0, lon0, dlat, dlon, rows, cols } = grid;
  const span = Math.max(rows, cols) + 2 * pad;
  const cell = Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, Math.floor(MAX_SIDE_PX / span)));
  const width = (cols + 2 * pad) * cell;
  const height = (rows + 2 * pad) * cell;
  const south = lat0 - (pad + 0.5) * dlat;
  const north = lat0 + (rows - 0.5 + pad) * dlat;
  const west = lon0 - (pad + 0.5) * dlon;
  const east = lon0 + (cols - 0.5 + pad) * dlon;
  // The map stretches the image linearly in Web Mercator, so rows are spaced evenly in
  // Mercator y, not in latitude; otherwise a tall corridor would drift north of its cells.
  const top = mercatorY(north);
  const bottom = mercatorY(south);
  // Image row 0 is the north edge; grid row 0 is the south.
  const [row0, row1, rowT, row0In, row1In, rowPos] = axis(height, rows, (y) => {
    const lat = latFromMercatorY(top + ((bottom - top) * (y + 0.5)) / height);
    return (lat - lat0) / dlat;
  });
  const [col0, col1, colT, col0In, col1In, colPos] = axis(
    width,
    cols,
    (x) => (west + ((east - west) * (x + 0.5)) / width - lon0) / dlon,
  );
  return {
    width,
    height,
    corners: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
    row0,
    row1,
    rowT,
    row0In,
    row1In,
    col0,
    col1,
    colT,
    col0In,
    col1In,
    rowPos,
    colPos,
    mercator: { x0: west * RAD, x1: east * RAD, y0: top, y1: bottom },
  };
}

/** Drawn half width of the corridor: the API's buffer around each route. */
const CORRIDOR_MI = 40;
const MI_PER_DEG_LAT = 69.09;

/**
 * Opacity of the corridor per image pixel, 0..255: the routes stroked CORRIDOR_MI wide and blurred.
 * Following the roads rather than the grid cells keeps a coast-to-coast corridor, which is only a
 * couple of cells across, from being drawn as a staircase. Null when there is no canvas to draw on.
 */
export function corridorEdge(
  layout: FieldLayout,
  routes: readonly (readonly GeoJSON.Position[])[],
): Uint8ClampedArray | null {
  const { width, height } = layout;
  const { x0, x1, y0, y1 } = layout.mercator;
  if (routes.length === 0 || typeof document === 'undefined') return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
  if (!ctx) return null;
  // Draw in Mercator units, so the pen is round on the map whatever the image's aspect ratio.
  const sx = width / (x1 - x0);
  const sy = height / (y0 - y1);
  ctx.setTransform(sx, 0, 0, -sy, -x0 * sx, y0 * sy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'black';
  // A mile spans more Mercator units further north, so the pen widens with latitude.
  const halfWidth = (lat: number) => (CORRIDOR_MI / MI_PER_DEG_LAT) * RAD * (1 / Math.cos(lat * RAD));
  for (const line of routes) {
    if (line.length < 2) continue;
    for (let i = 1; i < line.length; i++) {
      const [lonA, latA] = line[i - 1];
      const [lonB, latB] = line[i];
      ctx.lineWidth = 2 * halfWidth((latA + latB) / 2);
      ctx.beginPath();
      ctx.moveTo(lonA * RAD, mercatorY(latA));
      ctx.lineTo(lonB * RAD, mercatorY(latB));
      ctx.stroke();
    }
  }
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
  // Two box blurs approximate a Gaussian; a third of the pen's width gives a soft, even edge.
  const radius = Math.max(1, Math.round((halfWidth((latFromMercatorY(y0) + latFromMercatorY(y1)) / 2) * sy) / 3));
  for (let pass = 0; pass < 2; pass++) {
    boxBlur(alpha, width, height, radius, 1, width);
    boxBlur(alpha, height, width, radius, width, 1);
  }
  return alpha;
}

/** Running-sum box blur along one axis: `lines` lines of `length` pixels, `step` apart within a line. */
function boxBlur(a: Uint8ClampedArray, length: number, lines: number, r: number, step: number, lineStep: number): void {
  const row = new Float32Array(length);
  const span = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let i = 0; i < length; i++) row[i] = a[base + i * step];
    // Zero outside the image, so the corridor fades out at its border too.
    let sum = 0;
    for (let i = 0; i <= Math.min(r, length - 1); i++) sum += row[i];
    for (let i = 0; i < length; i++) {
      a[base + i * step] = sum / span;
      const out = i - r;
      const into = i + r + 1;
      if (out >= 0) sum -= row[out];
      if (into < length) sum += row[into];
    }
  }
}

/** Spread of a strong area past the corridor; at least a cell and a half on a coarse grid. */
const SPILL_SIGMA_MI = 35;
const SPILL_SIGMA_CELLS = 1.5;
/** Largest spill margin, in cells, so a fine grid on a short trip keeps a small image. */
const MAX_SPILL_PAD = 14;

/** Where strong values spill past the corridor, on the grid grown by `pad` cells on every side. */
export interface FieldSpill {
  pad: number;
  /** The spilled value, meaningful only where `weight` is above 0. */
  values: Float32Array;
  /** 0..1: how much of the spill shows. Zero on corridor cells, which show their own forecast. */
  weight: Float32Array;
}

function spillSigmaCells(grid: HeatmapGrid): { rows: number; cols: number } {
  const midLat = grid.lat0 + ((grid.rows - 1) / 2) * grid.dlat;
  const rowMi = grid.dlat * MI_PER_DEG_LAT;
  const colMi = grid.dlon * MI_PER_DEG_LAT * Math.cos(midLat * RAD);
  const sigmaMi = Math.max(SPILL_SIGMA_MI, SPILL_SIGMA_CELLS * Math.max(rowMi, colMi));
  return { rows: sigmaMi / rowMi, cols: sigmaMi / colMi };
}

/** Cells of margin the image needs around the grid for the spill and the fade after it. */
export function fieldPad(grid: HeatmapGrid): number {
  const sigma = spillSigmaCells(grid);
  const reach = Math.ceil(2.5 * Math.max(sigma.rows, sigma.cols));
  return Math.min(MAX_SPILL_PAD, Math.max(FIELD_PAD_CELLS, reach));
}

/** Gaussian blur along one axis with zero outside: `lines` lines of `length` cells. */
function gaussianPass(src: Float32Array, length: number, lines: number, step: number, lineStep: number, sigma: number) {
  const reach = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, i) => Math.exp(-((i - reach) ** 2) / (2 * sigma * sigma)));
  const out = new Float32Array(src.length);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let k = Math.max(0, i - reach); k <= Math.min(length - 1, i + reach); k++) {
        sum += kernel[k - i + reach] * src[base + k * step];
      }
      out[base + i * step] = sum;
    }
  }
  return out;
}

/**
 * Lets the strong part of a frame (risk above Low, any weather) spill past the corridor like a
 * metaball: each strong cell spreads a Gaussian, and the spill shows where their sum is dense.
 * A long stormy stretch bulges out in a rounded outline; a single strong cell barely does. The
 * spilled value is the mean of the strong cells around it, so a High area stays High to its rim.
 */
export function extendField(
  values: Float32Array,
  mask: Uint8Array,
  grid: HeatmapGrid,
  metric: HeatmapMetric,
  pad = fieldPad(grid),
): FieldSpill {
  const { rows, cols } = grid;
  const R = rows + 2 * pad;
  const C = cols + 2 * pad;
  const strong = new Float32Array(R * C);
  const weighted = new Float32Array(R * C);
  const floor = metric === 'risk' ? 1 : 1e-3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!mask[i] || values[i] < floor) continue;
      const j = (r + pad) * C + c + pad;
      strong[j] = 1;
      weighted[j] = values[i];
    }
  }
  const sigma = spillSigmaCells(grid);
  const blur = (a: Float32Array) => gaussianPass(gaussianPass(a, C, R, 1, C, sigma.cols), R, C, C, 1, sigma.rows);
  const density = blur(strong);
  const total = blur(weighted);
  // A filled plane sums to 2 pi sigma^2 cells; half of that is the edge of a wide strong area.
  const norm = 1 / (Math.PI * sigma.rows * sigma.cols);
  const out = new Float32Array(R * C);
  const weight = new Float32Array(R * C);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const j = r * C + c;
      const gr = r - pad;
      const gc = c - pad;
      const onCorridor = gr >= 0 && gr < rows && gc >= 0 && gc < cols && mask[gr * cols + gc];
      if (onCorridor || density[j] <= 1e-6) continue;
      out[j] = total[j] / density[j];
      const s = Math.min(1, density[j] * norm);
      weight[j] = s * s * (3 - 2 * s);
    }
  }
  return { pad, values: out, weight };
}

/** 256 RGBA entries spread evenly over [0, max]. */
export interface ColorTable {
  rgba: Uint8ClampedArray;
  max: number;
  /** Ease the interpolation weights: for stepped tables, where it rounds the band outlines. */
  eased: boolean;
}

const ease = (t: number) => t * t * (3 - 2 * t);

const TABLE_SIZE = 256;
/** Width, in levels, of the blend between two risk colours. */
const BAND_SOFTNESS = 0.16;

/** Tokens are hex; anything else (a missing token) paints mid grey rather than a level's colour. */
function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [128, 128, 128];
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export type FieldPalette = Pick<MapPalette, 'risk' | 'weatherLow' | 'weatherHigh'>;

export function colorTable(metric: HeatmapMetric, palette: FieldPalette): ColorTable {
  const rgba = new Uint8ClampedArray(TABLE_SIZE * 4);
  if (metric === 'risk') {
    const max = RISK_LEVELS.length - 1;
    const rgb = RISK_LEVELS.map((level) => hexToRgb(palette.risk[level]));
    for (let i = 0; i < TABLE_SIZE; i++) {
      // The nearest level, so every area shows one of the API's levels; between two levels the
      // colour changes over a narrow band around the midpoint, which anti-aliases the outline.
      const v = (i / (TABLE_SIZE - 1)) * max;
      const lo = Math.min(max - 1, Math.floor(v));
      const s = Math.min(1, Math.max(0, (v - lo - 0.5) / BAND_SOFTNESS + 0.5));
      const mix = (a: number, b: number) => a + (b - a) * s;
      rgba.set(
        [
          mix(rgb[lo][0], rgb[lo + 1][0]),
          mix(rgb[lo][1], rgb[lo + 1][1]),
          mix(rgb[lo][2], rgb[lo + 1][2]),
          mix(RISK_FIELD_ALPHA[lo], RISK_FIELD_ALPHA[lo + 1]) * 255,
        ],
        i * 4,
      );
    }
    return { rgba, max, eased: true };
  }
  const meta = METRIC_META[metric];
  const ends = { low: hexToRgb(palette.weatherLow), high: hexToRgb(palette.weatherHigh) };
  for (let i = 0; i < TABLE_SIZE; i++) {
    const [r, g, b, a] = rampColor(meta, (i / (TABLE_SIZE - 1)) * meta.max, ends);
    rgba.set([r, g, b, a * 255], i * 4);
  }
  return { rgba, max: meta.max, eased: false };
}

/** Bilinear lookup on the spill grid for one image axis: cells and weights, -1 past its edge. */
function spillAxis(pos: Float32Array, pad: number, cells: number, eased: boolean) {
  const lo = new Int32Array(pos.length);
  const hi = new Int32Array(pos.length);
  const t = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i] + pad;
    const below = Math.floor(p);
    lo[i] = below >= 0 && below < cells ? below : -1;
    hi[i] = below + 1 >= 0 && below + 1 < cells ? below + 1 : -1;
    t[i] = eased ? ease(p - below) : p - below;
  }
  return { lo, hi, t };
}

/**
 * Writes one frame into `out` (width * height * 4, straight alpha). `edge`, from corridorEdge,
 * shapes the corridor's outline; without it the outline follows the grid cells. `spill`, from
 * extendField, shows past that outline and fades into it.
 */
export function paintField(
  layout: FieldLayout,
  mask: Uint8Array,
  values: Float32Array,
  cols: number,
  table: ColorTable,
  out: Uint8ClampedArray,
  edge: Uint8ClampedArray | null = null,
  spill: FieldSpill | null = null,
): void {
  const { width, height, row0, row1, rowT, row0In, row1In, col0, col1, colT, col0In, col1In } = layout;
  const { rgba, max, eased } = table;
  const toIndex = (TABLE_SIZE - 1) / max;
  const spillCols = spill ? cols + 2 * spill.pad : 0;
  const spillRows = spill ? spill.values.length / spillCols : 0;
  const sy = spill ? spillAxis(layout.rowPos, spill.pad, spillRows, eased) : null;
  const sx = spill ? spillAxis(layout.colPos, spill.pad, spillCols, eased) : null;
  let p = 0;
  for (let y = 0; y < height; y++) {
    const a = row0[y] * cols;
    const b = row1[y] * cols;
    const ty = eased ? ease(rowT[y]) : rowT[y];
    const in0 = row0In[y];
    const in1 = row1In[y];
    for (let x = 0; x < width; x++, p += 4) {
      const c0 = col0[x];
      const c1 = col1[x];
      const tx = eased ? ease(colT[x]) : colT[x];
      // Corner weights, zero where a corner lies outside the corridor or past the grid.
      const w00 = (1 - tx) * (1 - ty) * mask[a + c0] * in0 * col0In[x];
      const w01 = tx * (1 - ty) * mask[a + c1] * in0 * col1In[x];
      const w10 = (1 - tx) * ty * mask[b + c0] * in1 * col0In[x];
      const w11 = tx * ty * mask[b + c1] * in1 * col1In[x];
      const inside = w00 + w01 + w10 + w11;
      let v = 0;
      let shown = 0;
      if (inside >= 0.05) {
        // Normalised by the corners that exist, so the edge fades out without pulling values to 0.
        v = (w00 * values[a + c0] + w01 * values[a + c1] + w10 * values[b + c0] + w11 * values[b + c1]) / inside;
        if (edge) {
          // The road-shaped outline, also faded wherever the API's cells stop short of it.
          shown = (edge[p >> 2] * inside) / 255;
        } else {
          // A soft edge halfway between the last cell inside and the first outside.
          const e = Math.min(1, Math.max(0, (inside - 0.15) / 0.7));
          shown = e * e * (3 - 2 * e);
        }
      }
      if (spill && sx && sy && shown < 1) {
        const r0 = sy.lo[y];
        const r1 = sy.hi[y];
        const c0s = sx.lo[x];
        const c1s = sx.hi[x];
        const t = sy.t[y];
        const u = sx.t[x];
        let weight = 0;
        let sum = 0;
        const add = (r: number, c: number, w: number) => {
          if (r < 0 || c < 0) return;
          const j = r * spillCols + c;
          const sw = w * spill.weight[j];
          weight += sw;
          sum += sw * spill.values[j];
        };
        add(r0, c0s, (1 - t) * (1 - u));
        add(r0, c1s, (1 - t) * u);
        add(r1, c0s, t * (1 - u));
        add(r1, c1s, t * u);
        // The spill only fills what the corridor leaves uncovered.
        const room = weight * (1 - shown);
        if (room > 1e-3) {
          v = (v * shown + (sum / weight) * room) / (shown + room);
          shown += room;
        }
      }
      if (shown <= 0) {
        out[p + 3] = 0;
        continue;
      }
      const k = Math.min(TABLE_SIZE - 1, Math.max(0, Math.round(v * toIndex))) * 4;
      out[p] = rgba[k];
      out[p + 1] = rgba[k + 1];
      out[p + 2] = rgba[k + 2];
      out[p + 3] = rgba[k + 3] * shown;
    }
  }
}

/**
 * Weather with a softened fringe: each cell takes the larger of its own value and a [1, 2, 1]
 * blur of its corridor neighbours. The forecast often holds one value over several cells and
 * drops to dry in a single step, which drew rain as blocks with a hard rim; this spreads the rim
 * over the next cell while a peak keeps its full value, so weather is never drawn milder.
 */
export function softenFringe(values: Float32Array, mask: Uint8Array, rows: number, cols: number): Float32Array {
  const pass = (src: Float32Array, dRow: number, dCol: number) => {
    const out = new Float32Array(src.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let weight = 0;
        for (let k = -1; k <= 1; k++) {
          const rr = r + k * dRow;
          const cc = c + k * dCol;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const i = rr * cols + cc;
          if (!mask[i]) continue;
          const w = k === 0 ? 2 : 1;
          sum += w * src[i];
          weight += w;
        }
        out[r * cols + c] = weight > 0 ? sum / weight : 0;
      }
    }
    return out;
  };
  const blurred = pass(pass(values, 1, 0), 0, 1);
  for (let i = 0; i < blurred.length; i++) blurred[i] = Math.max(values[i], blurred[i]);
  return blurred;
}

/** The corridor outline depends only on the plan, so switching metric reuses it. */
const EDGES = new WeakMap<HeatmapData, Uint8ClampedArray | null>();

/**
 * Every hour of one metric, painted on first use and kept, so revisiting an hour while dragging
 * costs nothing. The rest are painted in idle time after the first.
 */
export class FieldFrames {
  readonly layout: FieldLayout;
  private readonly frames: (ImageData | null)[];
  private readonly table: ColorTable;
  private idle: number | null = null;
  private readonly data: HeatmapData;
  private readonly metric: HeatmapMetric;
  private readonly edge: Uint8ClampedArray | null;

  constructor(data: HeatmapData, metric: HeatmapMetric, palette: MapPalette) {
    this.data = data;
    this.metric = metric;
    this.layout = fieldLayout(data.grid, fieldPad(data.grid));
    this.table = colorTable(metric, palette);
    this.frames = data.hours.map(() => null);
    let edge = EDGES.get(data);
    if (edge === undefined) {
      edge = corridorEdge(this.layout, data.routes);
      EDGES.set(data, edge);
    }
    this.edge = edge;
  }

  get count(): number {
    return this.frames.length;
  }

  frame(hour: number): ImageData {
    const index = Math.min(this.frames.length - 1, Math.max(0, hour));
    let image = this.frames[index];
    if (!image) {
      const { width, height } = this.layout;
      const pixels = new Uint8ClampedArray(width * height * 4);
      const { mask, grid } = this.data;
      const raw = this.data.frames[this.metric][index];
      const values = this.metric === 'risk' ? raw : softenFringe(raw, mask, grid.rows, grid.cols);
      const spill = extendField(values, mask, grid, this.metric);
      paintField(this.layout, mask, values, grid.cols, this.table, pixels, this.edge, spill);
      image = new ImageData(pixels, width, height);
      this.frames[index] = image;
    }
    return image;
  }

  /** Paints the remaining hours a few at a time between frames. */
  prefetch(): void {
    const next = this.frames.findIndex((frame) => frame === null);
    if (next < 0 || this.idle !== null) return;
    const run = () => {
      this.idle = null;
      const started = performance.now();
      for (let i = 0; i < this.frames.length && performance.now() - started < 8; i++) {
        if (!this.frames[i]) this.frame(i);
      }
      this.prefetch();
    };
    this.idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(run, { timeout: 500 })
        : window.setTimeout(run, 16);
  }

  dispose(): void {
    if (this.idle === null) return;
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idle);
    else window.clearTimeout(this.idle);
    this.idle = null;
  }
}
