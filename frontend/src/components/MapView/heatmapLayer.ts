import type { ImageSource, Map as MapLibreMap } from 'maplibre-gl';
import { PLAY_STEP_MS, type HeatmapData, type HeatmapMetric } from '../../lib/heatmap';
import { FieldFrames, type Corners } from './heatmapField';
import type { MapPalette } from './riskStyle';

// One image layer. Changing the hour only swaps an already painted image into the source, so
// the slider never rebuilds geometry or waits on a worker. During playback the next hour is
// blended in pixel by pixel on the CPU: two stacked translucent layers would add their alpha
// mid-fade and make the whole field pulse, even where the hour changes nothing.

export const HEATMAP_LAYER = 'heatmap';

/** A whole playback step at a steady rate, so the field never stops between hours. */
export const FADE_MS = PLAY_STEP_MS;

const PLACEHOLDER: Corners = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

/** `beforeId` keeps the field under the routes, which stay readable on top of it. */
export function installHeatmapLayers(map: MapLibreMap, beforeId?: string): void {
  if (map.getSource(HEATMAP_LAYER)) return;
  map.addSource(HEATMAP_LAYER, { type: 'image', coordinates: PLACEHOLDER });
  map.addLayer(
    {
      id: HEATMAP_LAYER,
      type: 'raster',
      source: HEATMAP_LAYER,
      paint: {
        'raster-opacity': 0,
        // The style's default 300 ms transition would make a dragged slider trail behind.
        'raster-opacity-transition': { duration: 0, delay: 0 },
        'raster-fade-duration': 0,
        'raster-resampling': 'linear',
      },
    },
    beforeId,
  );
}

/** Offsets of the pixels that differ between two frames; only these need blending. */
export function changedPixels(from: Uint8ClampedArray, to: Uint8ClampedArray): Uint32Array {
  const changed = new Uint32Array(to.length / 4);
  let count = 0;
  for (let k = 0; k < to.length; k += 4) {
    if (from[k] !== to[k] || from[k + 1] !== to[k + 1] || from[k + 2] !== to[k + 2] || from[k + 3] !== to[k + 3]) {
      changed[count++] = k;
    }
  }
  return changed.subarray(0, count);
}

/**
 * Writes the mix of `from` and `to` at `t` (0..1) into `out` for the listed pixels. Colours are
 * weighted by alpha, so a cell fading in takes its own colour instead of darkening through the
 * transparent black around it.
 */
export function blendPixels(
  from: Uint8ClampedArray,
  to: Uint8ClampedArray,
  changed: Uint32Array,
  t: number,
  out: Uint8ClampedArray,
): void {
  const s = 1 - t;
  for (let i = 0; i < changed.length; i++) {
    const k = changed[i];
    const wf = from[k + 3] * s;
    const wt = to[k + 3] * t;
    const alpha = wf + wt;
    if (alpha <= 0) {
      out[k + 3] = 0;
      continue;
    }
    out[k] = (from[k] * wf + to[k] * wt) / alpha;
    out[k + 1] = (from[k + 1] * wf + to[k + 1] * wt) / alpha;
    out[k + 2] = (from[k + 2] * wf + to[k + 2] * wt) / alpha;
    out[k + 3] = alpha;
  }
}

interface Fade {
  from: Uint8ClampedArray;
  to: ImageData;
  changed: Uint32Array;
  start: number;
  raf: number;
}

export class HeatmapRenderer {
  private frames: FieldFrames | null = null;
  private placed: Corners | null = null;
  private visible = false;
  /** The pixels on screen: a cached frame, or `scratch` mid-fade. Never written through. */
  private onScreen: Uint8ClampedArray | null = null;
  private scratch: ImageData | null = null;
  /** Holds where an interrupted fade had got to, since `scratch` is about to be overwritten. */
  private held: Uint8ClampedArray | null = null;
  private fade: Fade | null = null;

  private readonly map: MapLibreMap;

  constructor(map: MapLibreMap) {
    this.map = map;
  }

  /** A new basemap came with a fresh source: nothing is placed or shown on it yet. */
  detach(): void {
    this.cancelFade();
    this.placed = null;
    this.visible = false;
    this.onScreen = null;
  }

  /** A new plan, metric or palette; null hides the field. */
  setField(data: HeatmapData | null, metric: HeatmapMetric, palette: MapPalette): void {
    this.frames?.dispose();
    this.cancelFade();
    this.onScreen = null;
    this.scratch = null;
    this.held = null;
    if (!data) {
      this.frames = null;
      this.setVisible(false);
      return;
    }
    this.frames = new FieldFrames(data, metric, palette);
  }

  /** Shows an hour. `fade` blends from what is on screen, for playback. */
  show(hour: number, fade: boolean): void {
    const frames = this.frames;
    if (!frames) return;
    const target = frames.frame(hour);
    const from = this.onScreen;
    this.cancelFade();
    if (!fade || !from || from.length !== target.data.length) {
      this.put(target);
    } else {
      this.startFade(from, target);
    }
    this.setVisible(true);
    frames.prefetch();
  }

  dispose(): void {
    this.frames?.dispose();
    this.cancelFade();
  }

  private startFade(from: Uint8ClampedArray, to: ImageData): void {
    const { width, height } = to;
    if (!this.scratch || this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch = new ImageData(width, height);
    }
    const scratch = this.scratch;
    let start = from;
    if (from === scratch.data) {
      if (!this.held || this.held.length !== from.length) this.held = new Uint8ClampedArray(from.length);
      this.held.set(from);
      start = this.held;
    }
    const changed = changedPixels(start, to.data);
    if (changed.length === 0) {
      this.put(to);
      return;
    }
    // Pixels the hour does not change are copied once and then left alone.
    scratch.data.set(to.data);
    const fade: Fade = { from: start, to, changed, start: performance.now(), raf: 0 };
    const tick = (now: number) => {
      const t = Math.min(1, (now - fade.start) / FADE_MS);
      if (t >= 1) {
        this.fade = null;
        this.put(fade.to);
        return;
      }
      blendPixels(fade.from, fade.to.data, fade.changed, t, scratch.data);
      this.put(scratch);
      fade.raf = requestAnimationFrame(tick);
    };
    this.fade = fade;
    blendPixels(start, to.data, changed, 0, scratch.data);
    this.put(scratch);
    fade.raf = requestAnimationFrame(tick);
  }

  private put(image: ImageData): void {
    const source = this.map.getSource<ImageSource>(HEATMAP_LAYER);
    if (!source || !this.frames) return;
    const { corners } = this.frames.layout;
    // Coordinates change only with the plan; sending them with every frame would re-place the image.
    const moved = this.placed !== corners;
    source.updateImage(moved ? { image, coordinates: corners } : { image });
    this.placed = corners;
    this.onScreen = image.data;
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible || !this.map.getLayer(HEATMAP_LAYER)) return;
    this.map.setPaintProperty(HEATMAP_LAYER, 'raster-opacity', visible ? 1 : 0);
    this.visible = visible;
  }

  private cancelFade(): void {
    if (!this.fade) return;
    cancelAnimationFrame(this.fade.raf);
    this.fade = null;
  }
}
