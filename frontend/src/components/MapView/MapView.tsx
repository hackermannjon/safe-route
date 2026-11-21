import 'maplibre-gl/dist/maplibre-gl.css';
import './worker';
import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl, Popup } from 'maplibre-gl';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { PLAY_STEP_MS, type HeatmapData, type HeatmapMetric } from '../../lib/heatmap';
import { walkLine, type TruckPosition } from '../../lib/truck';
import type { Checkpoint, Route } from '../../types/api';
import { ATTRIBUTION_CLEARANCE_PX, fitPadding, type MapPadding, type MapTheme } from './camera';
import { CheckpointPopup } from './CheckpointPopup';
import {
  CHECKPOINT_LAYER,
  installCheckpointLayers,
  pickCheckpoint,
  setCheckpointData,
  setCheckpointFocus,
} from './checkpoints';
import { HeatmapRenderer, installHeatmapLayers } from './heatmapLayer';
import styles from './MapView.module.css';
import { popupCentered } from './popupPlacement';
import { addGlyphImages, readMapPalette, type MapPalette } from './riskStyle';
import {
  ROUTE_LAYER,
  installRouteLayers,
  pickRoute,
  routesBounds,
  setRiskSegments,
  setRouteData,
  setRouteSelection,
} from './routes';

export interface MapViewProps {
  routes: readonly Route[];
  selectedRouteId: string | null;
  onSelectRoute?: (id: string) => void;
  /** The selected route's checkpoints; other routes show none. */
  checkpoints?: readonly Checkpoint[];
  /** Shown with its details in a popup next to its dot. */
  selectedCheckpoint?: number | null;
  onSelectCheckpoint?: (index: number) => void;
  /** Escape, the popup's close button or a click on empty map. */
  onCloseCheckpoint?: () => void;
  /** The corridor weather field at one forecast hour; null hides it. */
  heatmap?: MapHeatmap | null;
  /** The truck on the selected route at the forecast hour; null hides it. */
  truck?: TruckPosition | null;
  /** Screen space covered by UI floating over the map; routes, popups and controls keep clear of it. */
  padding?: MapPadding;
  theme?: MapTheme;
  /** Phones pinch to zoom, so the buttons only take room there. */
  zoomControls?: boolean;
  /** Off when the screen closes its overlays with Escape itself, in its own order. */
  escapeCloses?: boolean;
}

export type { MapPadding, MapTheme };

export interface MapHeatmap {
  data: HeatmapData;
  hour: number;
  metric: HeatmapMetric;
  /** Playback cross-fades hours and glides the truck, unless the driver prefers reduced motion. */
  playing: boolean;
}

const NO_CHECKPOINTS: readonly Checkpoint[] = [];
/**
 * A checkpoint picked from the list or the map is always shown at this zoom, in or out, so stepping through
 * the list keeps one scale: close enough to tell the road, wide enough to see the next stops.
 */
export const CHECKPOINT_ZOOM = 9;
/** Playback follows the truck at about 150 miles across a phone, close enough to read the roads. */
export const FOLLOW_ZOOM = 8;
const EASE_MS = 600;
/** Clears the dot and its focus ring. */
const POPUP_OFFSET_PX = 14;

// Keyless vector basemaps; their attribution is required and stays on screen.
const BASEMAP_STYLE: Record<MapTheme, string> = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};
const NO_PADDING: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/** Lower 48, the opening view before a trip is planned. */
const INITIAL_BOUNDS: [[number, number], [number, number]] = [
  [-124.8, 24.4],
  [-66.9, 49.4],
];

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    // Browsers cap live contexts; release the probe instead of waiting for GC.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/** A whole playback step, so the truck never stops at an hour. */
const TRUCK_GLIDE_MS = PLAY_STEP_MS;

/** Pixels from the map's centre to the centre of the area the panels leave free. */
const freeCentreOffset = (pad: MapPadding): [number, number] => [
  (pad.left - pad.right) / 2,
  (pad.top - pad.bottom) / 2,
];

/** Puts `at` in the middle of the free area without changing the zoom, for per-frame follow. */
function centreOn(map: MapLibreMap, at: [number, number], pad: MapPadding): void {
  const [dx, dy] = freeCentreOffset(pad);
  const point = map.project(at);
  map.jumpTo({ center: map.unproject([point.x - dx, point.y - dy]) });
}

function TruckIcon({ arrived }: { arrived: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {arrived ? (
        <path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" fill="currentColor" />
      ) : (
        <path
          d="M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5V8h3.2a1.5 1.5 0 0 1 1.2.6l2.3 3.1c.2.3.3.6.3.9v3.9a1.5 1.5 0 0 1-1.5 1.5h-.6a2.6 2.6 0 0 1-5.1 0H9.2a2.6 2.6 0 0 1-5.1 0h-.6A1.5 1.5 0 0 1 2 16.5zm12 3.3V12h4.9l-1.6-2.2zM6.6 16.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2m9.8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

/** Frames every route in the free area, so the alternatives are visible next to the one selected. */
function fitRoutes(map: MapLibreMap, routes: readonly Route[], padding: MapPadding, animate: boolean): void {
  const bounds = routesBounds(routes);
  if (!bounds) return;
  const { clientWidth, clientHeight } = map.getContainer();
  map.fitBounds(bounds, {
    padding: fitPadding(padding, clientWidth, clientHeight),
    maxZoom: 11,
    duration: animate ? 800 : 0,
  });
}

/** Re-adds the plan's sources and layers; a basemap swap drops everything the app added. */
function installLayers(map: MapLibreMap, palette: MapPalette): void {
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
  addGlyphImages(map, palette);
  installRouteLayers(map, palette, firstLabel);
  installHeatmapLayers(map, ROUTE_LAYER.altCasing);
  installCheckpointLayers(map, palette);
}

export function MapView({
  routes,
  selectedRouteId,
  onSelectRoute,
  checkpoints = NO_CHECKPOINTS,
  selectedCheckpoint = null,
  onSelectCheckpoint,
  onCloseCheckpoint,
  heatmap = null,
  truck = null,
  padding = NO_PADDING,
  theme = 'dark',
  zoomControls = true,
  escapeCloses = true,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /** Bumped each time a basemap finishes loading, so every layer's data is pushed again. */
  const [styleVersion, setStyleVersion] = useState(0);
  const loaded = styleVersion > 0;
  const reducedMotion = useReducedMotion();
  // Read from map event handlers, which are bound once and must see the latest props.
  const latest = useRef({
    routes,
    selectedRouteId,
    onSelectRoute,
    onSelectCheckpoint,
    onCloseCheckpoint,
    reducedMotion,
    heatmap,
    padding,
    truck,
  });
  const [webgl] = useState(supportsWebGL);

  useEffect(() => {
    latest.current = {
      routes,
      selectedRouteId,
      onSelectRoute,
      onSelectCheckpoint,
      onCloseCheckpoint,
      reducedMotion,
      heatmap,
      padding,
      truck,
    };
  });

  // React renders the popup's content into this node; MapLibre positions it.
  const [popupNode] = useState(() => document.createElement('div'));
  const popupRef = useRef<Popup | null>(null);
  const [truckNode] = useState(() => {
    const node = document.createElement('div');
    node.className = styles.truck;
    return node;
  });
  const truckRef = useRef<Marker | null>(null);
  const glideRef = useRef<number | null>(null);
  // Set when playback starts; the driver panning or zooming the map hands the camera back.
  const followRef = useRef(false);
  const heatmapRef = useRef<HeatmapRenderer | null>(null);
  const paletteRef = useRef<MapPalette | null>(null);
  const themeRef = useRef(theme);
  const focused = checkpoints.find((cp) => cp.index === selectedCheckpoint) ?? null;
  const routeLabel = routes.find((route) => route.id === selectedRouteId)?.label ?? '';

  useEffect(() => {
    if (!webgl || !containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE[themeRef.current],
      bounds: INITIAL_BOUNDS,
      attributionControl: false,
      fadeDuration: latest.current.reducedMotion ? 0 : 300,
    });
    // OpenFreeMap and OpenStreetMap require visible attribution; narrow maps get the compact form.
    map.addControl(new AttributionControl(), 'bottom-right');
    heatmapRef.current = new HeatmapRenderer(map);
    // Fires for the first basemap and again after every theme swap.
    map.on('style.load', () => {
      const palette = readMapPalette();
      paletteRef.current = palette;
      installLayers(map, palette);
      heatmapRef.current?.detach();
      setStyleVersion((v) => v + 1);
    });
    // Above the dot rather than beside it, so where it lands depends only on the dot's position.
    popupRef.current = new Popup({
      anchor: 'bottom',
      offset: POPUP_OFFSET_PX,
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      maxWidth: 'none',
      className: styles.popup,
    }).setDOMContent(popupNode);
    map.on('click', (event) => {
      const { selectedRouteId: current, onSelectRoute: select, onSelectCheckpoint: selectCheckpoint } = latest.current;
      // Dots sit on the selected route, so they win over the route line under them.
      const index = pickCheckpoint(map, event.point);
      if (index !== null) {
        selectCheckpoint?.(index);
        return;
      }
      const id = pickRoute(map, event.point, current);
      if (id && id !== current) select?.(id);
      else latest.current.onCloseCheckpoint?.();
    });
    for (const layer of [ROUTE_LAYER.hit, CHECKPOINT_LAYER.glyphs, CHECKPOINT_LAYER.ends]) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
      });
    }
    truckRef.current = new Marker({ element: truckNode, anchor: 'center' });
    mapRef.current = map;
    return () => {
      heatmapRef.current?.dispose();
      heatmapRef.current = null;
      if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
      truckRef.current?.remove();
      truckRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      setStyleVersion(0);
    };
  }, [webgl, popupNode, truckNode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zoomControls) return;
    const control = new NavigationControl({ showCompass: false });
    map.addControl(control, 'top-right');
    return () => {
      // Unmounting removes the map first, and its controls with it.
      if (mapRef.current === map) map.removeControl(control);
    };
  }, [zoomControls, webgl]);

  // The tokens flip with the same media query that picks the theme, so they are current here.
  useEffect(() => {
    const map = mapRef.current;
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    // diff: false so the swap never tries to merge app layers into the new style's layer list.
    map?.setStyle(BASEMAP_STYLE[theme], { diff: false });
  }, [theme]);

  const heatmapData = heatmap?.data ?? null;
  const heatmapMetric = heatmap?.metric ?? 'risk';
  const heatmapHour = heatmap?.hour ?? 0;

  useEffect(() => {
    const renderer = heatmapRef.current;
    if (!renderer || !styleVersion || !paletteRef.current) return;
    renderer.setField(heatmapData, heatmapMetric, paletteRef.current);
    renderer.show(latest.current.heatmap?.hour ?? 0, false);
  }, [heatmapData, heatmapMetric, styleVersion]);

  useEffect(() => {
    const { heatmap: current, reducedMotion: still } = latest.current;
    if (loaded) heatmapRef.current?.show(heatmapHour, Boolean(current?.playing) && !still);
  }, [heatmapHour, loaded]);

  const playing = Boolean(heatmap?.playing);
  useEffect(() => {
    const map = mapRef.current;
    const marker = truckRef.current;
    if (!map || !marker || !loaded || !playing || !marker.getElement().isConnected) return;
    followRef.current = true;
    const { padding: pad, reducedMotion: still } = latest.current;
    map.easeTo({
      center: marker.getLngLat(),
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      offset: freeCentreOffset(pad),
      duration: still ? 0 : EASE_MS,
    });
  }, [playing, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    // Only the driver's own gestures carry an originalEvent; the camera's eases do not.
    const release = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) followRef.current = false;
    };
    map.on('dragstart', release);
    map.on('zoomstart', release);
    return () => {
      map.off('dragstart', release);
      map.off('zoomstart', release);
    };
  }, [loaded]);

  const truckLon = truck?.lon;
  const truckLat = truck?.lat;
  const truckArrived = truck?.arrived ?? false;
  useEffect(() => {
    truckNode.toggleAttribute('data-arrived', truckArrived);
  }, [truckNode, truckArrived]);
  useEffect(() => {
    const map = mapRef.current;
    const marker = truckRef.current;
    if (!map || !marker || !loaded) return;
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
    if (truckLon === undefined || truckLat === undefined) {
      followRef.current = false;
      marker.remove();
      return;
    }
    const target: [number, number] = [truckLon, truckLat];
    const { heatmap: current, reducedMotion: still, truck: position } = latest.current;
    const onMap = marker.getElement().isConnected;
    // Whichever way the truck moves, a following camera keeps it in the middle of the free area.
    const follow = (at: [number, number]) => {
      if (followRef.current && !map.isMoving()) centreOn(map, at, latest.current.padding);
    };
    const trail = position?.trail ?? [];
    if (!onMap || !current?.playing || still || trail.length < 2) {
      marker.setLngLat(target);
      if (!onMap) marker.addTo(map);
      follow(target);
      return;
    }
    // Between hours the truck drives the past hour's stretch of the route at a steady pace that
    // lasts the whole step, so it keeps to the road and never pauses at an hour.
    const along = walkLine(trail);
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / TRUCK_GLIDE_MS);
      const at = along(t);
      marker.setLngLat(at);
      follow(at);
      glideRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    glideRef.current = requestAnimationFrame(step);
  }, [truckLon, truckLat, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleVersion) setRouteData(map, routes);
  }, [routes, styleVersion]);

  // A new plan is a new array; picking another route keeps it, so the camera stays put.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) fitRoutes(map, routes, latest.current.padding, !latest.current.reducedMotion);
  }, [routes, loaded]);

  // The sheet moving or a panel opening changes the free area; keep the trip in it, unless a
  // checkpoint is open, which has its own placement.
  const { top: padTop, right: padRight, bottom: padBottom, left: padLeft } = padding;
  const firstPadding = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (firstPadding.current) {
      firstPadding.current = false;
      return;
    }
    if (popupRef.current?.isOpen()) return;
    const { routes: current, reducedMotion: still } = latest.current;
    const pad = { top: padTop, right: padRight, bottom: padBottom, left: padLeft };
    const marker = truckRef.current;
    if (followRef.current && marker?.getElement().isConnected) {
      map.easeTo({ center: marker.getLngLat(), offset: freeCentreOffset(pad), duration: still ? 0 : EASE_MS });
      return;
    }
    fitRoutes(map, current, pad, !still);
  }, [padTop, padRight, padBottom, padLeft, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    setRouteSelection(map, selectedRouteId);
    setRiskSegments(
      map,
      routes.find((route) => route.id === selectedRouteId),
    );
  }, [routes, selectedRouteId, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleVersion) setCheckpointData(map, checkpoints);
  }, [checkpoints, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup || !styleVersion) return;
    setCheckpointFocus(map, selectedCheckpoint);
    const target = checkpoints.find((cp) => cp.index === selectedCheckpoint);
    if (!target) {
      popup.remove();
      return;
    }
    popup.setLngLat([target.lon, target.lat]);
    if (!popup.isOpen()) popup.addTo(map);

    const element = popup.getElement();
    const box = { width: element.offsetWidth, height: element.offsetHeight + POPUP_OFFSET_PX };
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    // Placement works in the free area's own coordinates, then shifts back onto the map.
    const pad = latest.current.padding;
    const view = {
      width: Math.max(0, width - pad.left - pad.right),
      height: Math.max(0, height - pad.top - pad.bottom - ATTRIBUTION_CLEARANCE_PX),
    };
    const to = popupCentered(box, view);
    map.easeTo({
      center: [target.lon, target.lat],
      zoom: CHECKPOINT_ZOOM,
      // Offset rather than camera padding, which would persist and skew later fits.
      offset: [to.x + pad.left - width / 2, to.y + pad.top - height / 2],
      duration: latest.current.reducedMotion ? 0 : EASE_MS,
    });
  }, [selectedCheckpoint, checkpoints, styleVersion]);

  const popupOpen = focused !== null;
  useEffect(() => {
    if (!popupOpen || !escapeCloses) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A field that used Escape for itself (closing its suggestions) has already handled it.
      if (event.key === 'Escape' && !event.defaultPrevented) latest.current.onCloseCheckpoint?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [popupOpen, escapeCloses]);

  const insets = {
    '--map-inset-top': `${padTop}px`,
    '--map-inset-right': `${padRight}px`,
    '--map-inset-bottom': `${padBottom}px`,
    '--map-inset-left': `${padLeft}px`,
  } as CSSProperties;

  if (!webgl) {
    return (
      <div className={styles.fallback} style={insets} role="note">
        The map needs WebGL, which this browser has turned off. Route details are still listed.
      </div>
    );
  }
  return (
    <>
      <div
        ref={containerRef}
        className={styles.map}
        style={insets}
        data-theme={theme}
        role="region"
        aria-label="Route map"
      />
      {truck && createPortal(<TruckIcon arrived={truck.arrived} />, truckNode)}
      {focused &&
        createPortal(
          <CheckpointPopup
            key={`${selectedRouteId}:${focused.index}`}
            checkpoint={focused}
            routeLabel={routeLabel}
            onClose={onCloseCheckpoint}
          />,
          popupNode,
        )}
    </>
  );
}

export default MapView;
