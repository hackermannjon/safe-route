import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../../services/api';
import type { GeocodeResult, PlanResponse, Route } from '../../../types/api';
import { useTripPlannerViewModel } from '../useTripPlannerViewModel';
import { clearPlaceSearchCache } from '../usePlaceSearch';

const CHICAGO: GeocodeResult = { label: 'Chicago, Illinois, United States', name: 'Chicago', lat: 41.88, lon: -87.63 };
const DENVER: GeocodeResult = { label: 'Denver, Colorado, United States', name: 'Denver', lat: 39.74, lon: -104.99 };

function route(id: string, distance_mi: number, duration_s: number, via: string[]): Route {
  return {
    id,
    label: `Route ${id}`,
    via,
    distance_mi,
    duration_s,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-87.63, 41.88],
        [-104.99, 39.74],
      ],
    },
  };
}

const PLAN: PlanResponse = {
  notices: [],
  routes: [
    route('A', 1016.6, 56739, ['I-88', 'I-80', 'I-76']),
    route('B', 1058.8, 59760, ['US-20', 'I-80', 'I-76']),
    route('C', 1116.3, 62640, []),
  ],
};

function pickBoth(result: { current: ReturnType<typeof useTripPlannerViewModel> }) {
  act(() => result.current.origin.onSelect(CHICAGO));
  act(() => result.current.destination.onSelect(DENVER));
}

describe('useTripPlannerViewModel', () => {
  beforeEach(() => {
    clearPlaceSearchCache();
    vi.spyOn(api, 'geocode').mockResolvedValue([]);
  });

  it('asks for both places before planning', async () => {
    const plan = vi.spyOn(api, 'plan');
    const { result } = renderHook(() => useTripPlannerViewModel());

    await act(() => result.current.submit());

    expect(plan).not.toHaveBeenCalled();
    expect(result.current.origin.error).toBe('Pick a starting point from the list.');
    expect(result.current.destination.error).toBe('Pick a destination from the list.');
  });

  it('plans with the picked places and lists every route', async () => {
    const plan = vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    expect(plan).toHaveBeenCalledWith(
      {
        origin: { lat: 41.88, lon: -87.63, label: CHICAGO.label },
        destination: { lat: 39.74, lon: -104.99, label: DENVER.label },
      },
      expect.any(AbortSignal),
    );
    expect(result.current.routes).toBe(PLAN.routes);
    expect(result.current.routesHeading).toBe('3 routes');
    expect(result.current.summaries[0]).toEqual({
      id: 'A',
      label: 'Route A',
      distance: '1,017 mi',
      duration: '15 h 45 min',
      via: 'via I-88, I-80, I-76',
    });
    expect(result.current.summaries[2].via).toBe('');
    expect(result.current.notices).toEqual([]);
    expect(result.current.planning).toBe(false);
  });

  it('selects the first route by default and switches on request', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());
    expect(result.current.selectedRouteId).toBe('A');

    act(() => result.current.selectRoute('C'));
    expect(result.current.selectedRouteId).toBe('C');

    // Picking a route must not hand the map a new route list, or it would re-frame the camera.
    const routes = result.current.routes;
    act(() => result.current.selectRoute('B'));
    expect(result.current.routes).toBe(routes);
  });

  it('ignores ids that are not in the current plan', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());

    act(() => result.current.selectRoute('Z'));

    expect(result.current.selectedRouteId).toBe('A');
  });

  it('resets the selection and passes notices on a new plan', async () => {
    const plan = vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());
    act(() => result.current.selectRoute('B'));

    const notice = 'Only one route was available for this trip.';
    plan.mockResolvedValue({ ...PLAN, notices: [notice], routes: [route('A', 900, 50000, ['I-80'])] });
    await act(() => result.current.submit());

    expect(result.current.selectedRouteId).toBe('A');
    expect(result.current.notices).toEqual([notice]);
    expect(result.current.routesHeading).toBe('1 route');
  });

  it('drops the pick when the text is edited afterwards', () => {
    const { result } = renderHook(() => useTripPlannerViewModel());
    act(() => result.current.origin.onSelect(CHICAGO));
    expect(result.current.origin.resolved).toBe(true);

    act(() => result.current.origin.onQueryChange('Chicag'));

    expect(result.current.origin.resolved).toBe(false);
  });

  it('shows a field error from the server next to that field', async () => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError('No truck route reaches this place.', 400, 'destination'));
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    expect(result.current.destination.error).toBe('No truck route reaches this place.');
    expect(result.current.error).toBeNull();
  });

  it('shows a general error when the server fails', async () => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError('The routing service did not respond.', 502));
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    await waitFor(() => expect(result.current.error).toBe('The routing service did not respond.'));
    expect(result.current.routes).toEqual([]);
    expect(result.current.selectedRouteId).toBeNull();
  });

  it('puts a server error on origin.lat next to its field', async () => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError('Latitude must be between -90 and 90.', 400, 'origin.lat'));
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    expect(result.current.origin.error).toBe('Latitude must be between -90 and 90.');
    expect(result.current.error).toBeNull();
  });
});

describe('useTripPlannerViewModel layout', () => {
  beforeEach(() => {
    clearPlaceSearchCache();
    vi.spyOn(api, 'geocode').mockResolvedValue([]);
  });

  it('moves from the empty start through loading to results', async () => {
    let resolve: (plan: PlanResponse) => void = () => {};
    vi.spyOn(api, 'plan').mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useTripPlannerViewModel());
    expect(result.current.status).toBe('idle');
    expect(result.current.hasResults).toBe(false);
    expect(result.current.formExpanded).toBe(true);

    pickBoth(result);
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.submit();
    });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      resolve(PLAN);
      await pending;
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.formExpanded).toBe(false);
    expect(result.current.tripLine).toEqual({ route: 'Chicago → Denver' });
    expect(result.current.selectedSummary?.id).toBe('A');
  });

  it('sends the same request again on retry', async () => {
    const plan = vi.spyOn(api, 'plan').mockRejectedValueOnce(new ApiError('Routing timed out.', 502));
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Routing timed out.');

    plan.mockResolvedValue(PLAN);
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(plan).toHaveBeenCalledTimes(2);
    expect(plan.mock.calls[1][0]).toEqual(plan.mock.calls[0][0]);
  });

  it('opens the form again on a field the server rejected', async () => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError('No truck route reaches this place.', 400, 'destination'));
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    pickBoth(result);
    await act(() => result.current.submit());
    expect(result.current.formOpen).toBe(true);
    expect(result.current.destination.error).toBe('No truck route reaches this place.');
  });

  it('fills a sample trip and opens the form on it', () => {
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    act(() => result.current.fillExample());
    expect(result.current.formOpen).toBe(true);
    expect(result.current.origin.query).toBe('Chicago, Illinois, United States');
    expect(result.current.destination.query).toBe('Denver, Colorado, United States');
  });

  it('closes what is open with Escape on a phone, the topmost first', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    pickBoth(result);
    await act(() => result.current.submit());
    act(() => result.current.openForm());

    const escape = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    escape();
    expect(result.current.formOpen).toBe(false);
    expect(result.current.sheetSnap).toBe('half');
    escape();
    expect(result.current.sheetSnap).toBe('peek');
  });
});
