import { create } from 'zustand';
import type { PlanResponse } from '../types/api';

// The trip the screen is showing: the plan and what is selected on it. Form input stays in the
// ViewModel; nothing else needs it.

export interface TripState {
  plan: PlanResponse | null;
  selectedRouteId: string | null;

  setPlan: (plan: PlanResponse) => void;
  clearPlan: () => void;
  selectRoute: (routeId: string) => void;
  reset: () => void;
}

const INITIAL = {
  plan: null,
  selectedRouteId: null,
} satisfies Partial<TripState>;

export const useTripStore = create<TripState>()((set, get) => ({
  ...INITIAL,

  setPlan: (plan) => set({ plan, selectedRouteId: plan.routes[0]?.id ?? null }),

  clearPlan: () => set({ plan: null, selectedRouteId: null }),

  // Ids come from the server, so only ids of the current plan may become the selection.
  selectRoute: (routeId) => {
    const { plan, selectedRouteId } = get();
    if (routeId === selectedRouteId || !plan?.routes.some((route) => route.id === routeId)) return;
    set({ selectedRouteId: routeId });
  },

  reset: () => set(INITIAL),
}));

// Subscribe through these so a component re-renders only on the slice it reads.
export const selectPlan = (s: TripState) => s.plan;
export const selectSelectedRouteId = (s: TripState) => s.selectedRouteId;
