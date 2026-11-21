import { create } from 'zustand';
import type { PlanResponse } from '../types/api';

// The trip the screen is showing. Form input stays in the ViewModel; nothing else needs it.

export interface TripState {
  plan: PlanResponse | null;

  setPlan: (plan: PlanResponse) => void;
  clearPlan: () => void;
  reset: () => void;
}

const INITIAL = {
  plan: null,
} satisfies Partial<TripState>;

export const useTripStore = create<TripState>()((set) => ({
  ...INITIAL,

  setPlan: (plan) => set({ plan }),

  clearPlan: () => set({ plan: null }),

  reset: () => set(INITIAL),
}));

// Subscribe through these so a component re-renders only on the slice it reads.
export const selectPlan = (s: TripState) => s.plan;
