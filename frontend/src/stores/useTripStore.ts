import { create } from 'zustand';
import type { PlanResponse } from '../types/api';

// The trip the screen is showing: the plan and what is selected on it. Form input stays in the
// ViewModel; nothing else needs it.

export interface TripState {
  plan: PlanResponse | null;
  selectedRouteId: string | null;
  /** A checkpoint index on the selected route. */
  selectedCheckpoint: number | null;

  setPlan: (plan: PlanResponse) => void;
  clearPlan: () => void;
  selectRoute: (routeId: string) => void;
  selectCheckpoint: (index: number | null) => void;
  reset: () => void;
}

const INITIAL = {
  plan: null,
  selectedRouteId: null,
  selectedCheckpoint: null,
} satisfies Partial<TripState>;

export const useTripStore = create<TripState>()((set, get) => ({
  ...INITIAL,

  setPlan: (plan) => set({ plan, selectedRouteId: plan.routes[0]?.id ?? null, selectedCheckpoint: null }),

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

  reset: () => set(INITIAL),
}));

// Subscribe through these so a component re-renders only on the slice it reads.
export const selectPlan = (s: TripState) => s.plan;
export const selectSelectedRouteId = (s: TripState) => s.selectedRouteId;
export const selectSelectedCheckpoint = (s: TripState) => s.selectedCheckpoint;
