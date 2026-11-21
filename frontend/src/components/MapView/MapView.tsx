import 'maplibre-gl/dist/maplibre-gl.css';
import './worker';
import { AttributionControl, Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { Route } from '../../types/api';
import { fitPadding, type MapPadding, type MapTheme } from './camera';
import { readMapPalette, type MapPalette } from './mapPalette';
import styles from './MapView.module.css';
import { installRouteLayers, routesBounds, setRouteData } from './routes';

export interface MapViewProps {
  routes: readonly Route[];
  /** Screen space covered by UI floating over the map; routes and controls keep clear of it. */
  padding?: MapPadding;
  theme?: MapTheme;
  /** Phones pinch to zoom, so the buttons only take room there. */
  zoomControls?: boolean;
}

export type { MapPadding, MapTheme };

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

/** Frames the plan in the free area. */
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
  installRouteLayers(map, palette, firstLabel);
}

export function MapView({ routes, padding = NO_PADDING, theme = 'dark', zoomControls = true }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /** Bumped each time a basemap finishes loading, so every layer's data is pushed again. */
  const [styleVersion, setStyleVersion] = useState(0);
  const loaded = styleVersion > 0;
  const reducedMotion = useReducedMotion();
  // Read by effects that need the latest props without re-running when they change.
  const latest = useRef({
    routes,
    reducedMotion,
    padding,
  });
  const [webgl] = useState(supportsWebGL);

  useEffect(() => {
    latest.current = {
      routes,
      reducedMotion,
      padding,
    };
  });

  const themeRef = useRef(theme);

  useEffect(() => {
    if (!webgl || !containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE[themeRef.current],
      bounds: INITIAL_BOUNDS,
      attributionControl: false,
    });
    // OpenFreeMap and OpenStreetMap require visible attribution; narrow maps get the compact form.
    map.addControl(new AttributionControl(), 'bottom-right');
    // Fires for the first basemap and again after every theme swap.
    map.on('style.load', () => {
      const palette = readMapPalette();
      installLayers(map, palette);
      setStyleVersion((v) => v + 1);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setStyleVersion(0);
    };
  }, [webgl]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleVersion) setRouteData(map, routes);
  }, [routes, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) fitRoutes(map, routes, latest.current.padding, !latest.current.reducedMotion);
  }, [routes, loaded]);

  // The sheet moving or a panel opening changes the free area; keep the trip in it.
  const { top: padTop, right: padRight, bottom: padBottom, left: padLeft } = padding;
  const firstPadding = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (firstPadding.current) {
      firstPadding.current = false;
      return;
    }
    const { routes: current, reducedMotion: still } = latest.current;
    fitRoutes(map, current, { top: padTop, right: padRight, bottom: padBottom, left: padLeft }, !still);
  }, [padTop, padRight, padBottom, padLeft, loaded]);

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
    <div
      ref={containerRef}
      className={styles.map}
      style={insets}
      data-theme={theme}
      role="region"
      aria-label="Route map"
    />
  );
}

export default MapView;
