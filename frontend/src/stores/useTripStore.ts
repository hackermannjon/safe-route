import { create } from 'zustand';
import { MAX_FORECAST_HOUR, type HeatmapData, type HeatmapMetric } from '../lib/heatmap';
import type { PlanResponse, Route } from '../types/api';

// The trip the screen is showing: the plan, what is selected on it and the weather map's
// state. Form input stays in the ViewModel; nothing else needs it.

export interface TripState {
  plan: PlanResponse | null;
  selectedRouteId: string | null;
  /** A checkpoint index on the selected route. */
  selectedCheckpoint: number | null;

  heatmapOn: boolean;
  /** All 49 hours of the corridor forecast for the current plan, once loaded. */
  heatmapData: HeatmapData | null;
  heatmapLoading: boolean;
  heatmapError: string | null;
  metric: HeatmapMetric;
  /** Hours after departure shown by the forecast slider. */
  hour: number;
  playing: boolean;

  setPlan: (plan: PlanResponse) => void;
  clearPlan: () => void;
  selectRoute: (routeId: string) => void;
  selectCheckpoint: (index: number | null) => void;

  setHeatmapOn: (on: boolean) => void;
  heatmapRequested: () => void;
  heatmapLoaded: (data: HeatmapData) => void;
  heatmapFailed: (message: string) => void;
  /** Drops the field and rewinds the slider, for a new plan. The on/off choice stays. */
  resetHeatmap: () => void;
  setMetric: (metric: HeatmapMetric) => void;
  /** A hand-picked hour stops playback. */
  setHour: (hour: number) => void;
  setPlaying: (playing: boolean) => void;
  /** One playback step; stops at the last hour. */
  advanceHour: () => void;
  reset: () => void;
}

const clampHour = (hour: number) => Math.min(MAX_FORECAST_HOUR, Math.max(0, Math.round(hour)));

/** The API's pick, or the best-ranked route if that id is missing. */
export function recommendedRoute(plan: Pick<PlanResponse, 'routes' | 'recommended_route_id'>): Route | null {
  const named = plan.routes.find((route) => route.id === plan.recommended_route_id);
  if (named) return named;
  return plan.routes.reduce<Route | null>(
    (best, route) => (best === null || route.rank < best.rank ? route : best),
    null,
  );
}

const HEATMAP_CLEAR = {
  heatmapData: null,
  heatmapLoading: false,
  heatmapError: null,
  hour: 0,
  playing: false,
} as const;

const INITIAL = {
  plan: null,
  selectedRouteId: null,
  selectedCheckpoint: null,
  heatmapOn: false,
  metric: 'risk',
  ...HEATMAP_CLEAR,
} satisfies Partial<TripState>;

export const useTripStore = create<TripState>()((set, get) => ({
  ...INITIAL,

  setPlan: (plan) => set({ plan, selectedRouteId: recommendedRoute(plan)?.id ?? null, selectedCheckpoint: null }),

  clearPlan: () => set({ plan: null, selectedRouteId: null, selectedCheckpoint: null }),

  // Ids come from the server, so only ids of the current plan may become the selection.
  selectRoute: (routeId) => {
    const { plan, selectedRouteId } = get();
    if (routeId === selectedRouteId || !plan?.routes.some((route) => route.id === routeId)) return;
    // Checkpoint indices belong to one route; another route's same index is a different place.
    set({ selectedRouteId: routeId, selectedCheckpoint: null });
  },

  selectCheckpoint: (index) => {
    if (index === null) {
      set({ selectedCheckpoint: null });
      return;
    }
    const { plan, selectedRouteId } = get();
    const route = plan?.routes.find((r) => r.id === selectedRouteId);
    if (route?.checkpoints.some((cp) => cp.index === index)) set({ selectedCheckpoint: index });
  },

  setHeatmapOn: (on) => set(on ? { heatmapOn: true } : { heatmapOn: false, playing: false }),
  heatmapRequested: () => set({ heatmapLoading: true, heatmapError: null }),
  heatmapLoaded: (data) => set({ heatmapData: data, heatmapLoading: false, heatmapError: null }),
  heatmapFailed: (message) => set({ heatmapLoading: false, heatmapError: message }),
  resetHeatmap: () => set(HEATMAP_CLEAR),
  setMetric: (metric) => set({ metric }),
  setHour: (hour) => set({ hour: clampHour(hour), playing: false }),

  setPlaying: (playing) => {
    // Play from the end starts over rather than doing nothing.
    if (playing && get().hour >= MAX_FORECAST_HOUR) set({ hour: 0, playing: true });
    else set({ playing });
  },

  advanceHour: () => {
    const next = Math.min(get().hour + 1, MAX_FORECAST_HOUR);
    set({ hour: next, playing: next < MAX_FORECAST_HOUR && get().playing });
  },

  reset: () => set(INITIAL),
}));

// Subscribe through these so a component re-renders only on the slice it reads.
export const selectPlan = (s: TripState) => s.plan;
export const selectSelectedRouteId = (s: TripState) => s.selectedRouteId;
export const selectSelectedCheckpoint = (s: TripState) => s.selectedCheckpoint;
export const selectHeatmapOn = (s: TripState) => s.heatmapOn;
export const selectHeatmapData = (s: TripState) => s.heatmapData;
export const selectHasHeatmapData = (s: TripState) => s.heatmapData !== null;
export const selectHeatmapLoading = (s: TripState) => s.heatmapLoading;
export const selectHeatmapError = (s: TripState) => s.heatmapError;
export const selectMetric = (s: TripState) => s.metric;
export const selectHour = (s: TripState) => s.hour;
export const selectPlaying = (s: TripState) => s.playing;
