import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../../services/api';
import type { GeocodeResult, PlanResponse, Route, Weather } from '../../../types/api';
import { useTripPlannerViewModel, weatherSummary } from '../useTripPlannerViewModel';
import { clearPlaceSearchCache } from '../usePlaceSearch';

const CHICAGO: GeocodeResult = { label: 'Chicago, Illinois, United States', name: 'Chicago', lat: 41.88, lon: -87.63 };
const DENVER: GeocodeResult = { label: 'Denver, Colorado, United States', name: 'Denver', lat: 39.74, lon: -104.99 };

// Tests run in America/Chicago (see vite.config.ts): 13:30 UTC is Sat 7:30 AM CST.
const NOW = new Date('2026-11-21T13:30:00Z');
const DEPARTURE = '2026-11-21T14:00:00Z';

const at = (seconds: number) => new Date(Date.parse(DEPARTURE) + seconds * 1000).toISOString().replace('.000', '');

const CALM: Weather = { wind_mph: 10, gust_mph: 18, rain_in_h: 0, snow_in_h: 0, temp_f: 31.4, weather_code: 3 };

function route(id: string, distance_mi: number, duration_s: number, via: string[]): Route {
  // Constant speed, checkpoints every 500 mi; enough to tell the routes apart.
  const miles = [0, 500, distance_mi];
  return {
    id,
    label: `Route ${id}`,
    via,
    distance_mi,
    duration_s,
    arrival: at(duration_s),
    checkpoints: miles.map((mile, index) => ({
      index,
      mile,
      lat: 41.88 - (2.14 * mile) / distance_mi,
      lon: -87.63 - (17.36 * mile) / distance_mi,
      eta: at((duration_s * mile) / distance_mi),
      weather: { ...CALM, wind_mph: index === 1 ? 47 : 10 + index },
    })),
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
  departure: DEPARTURE,
  spacing_mi: 25,
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
    // Only Date is faked, so promises and the search debounce keep running.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    clearPlaceSearchCache();
    vi.spyOn(api, 'geocode').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
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
        departure: '2026-11-21T08:00:00-06:00',
        spacing_mi: 25,
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
      arrival: 'Arrives Sat 11:45 PM',
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

  it('starts departure at the next whole hour in local time, with picker bounds', () => {
    const { result } = renderHook(() => useTripPlannerViewModel());

    expect(result.current.departure.value).toBe('2026-11-21T08:00');
    expect(result.current.departure.min).toBe('2026-11-21T06:30');
    expect(result.current.departure.max).toBe('2026-11-28T07:30');
    expect(result.current.departure.hint).toBe('Your local time (CST)');
    expect(result.current.spacing.value).toBe(25);
    expect(result.current.spacing.options.map((o) => o.value)).toEqual([10, 25, 50]);
  });

  it('sends the chosen departure and spacing', async () => {
    const plan = vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    act(() => result.current.departure.onChange('2026-11-23T21:15'));
    act(() => result.current.spacing.onChange(10));
    await act(() => result.current.submit());

    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({ departure: '2026-11-23T21:15:00-06:00', spacing_mi: 10 }),
      expect.any(AbortSignal),
    );
  });

  it.each([
    ['2026-11-21T06:00', 'Departure cannot be more than 1 hour in the past.'],
    ['2026-12-01T08:00', 'Departure must be within the next 7 days (weather forecast range).'],
    ['', 'Choose a departure date and time.'],
  ])('refuses departure %s before asking the server', async (value, message) => {
    const plan = vi.spyOn(api, 'plan');
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    act(() => result.current.departure.onChange(value));
    await act(() => result.current.submit());

    expect(plan).not.toHaveBeenCalled();
    expect(result.current.departure.error).toBe(message);

    act(() => result.current.departure.onChange('2026-11-21T09:00'));
    expect(result.current.departure.error).toBeUndefined();
  });

  it('checks the window against the time of submitting, not of opening the form', async () => {
    const plan = vi.spyOn(api, 'plan');
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    // The form sat open for two hours, so its 8:00 AM default is now too far in the past.
    vi.setSystemTime(new Date('2026-11-21T15:30:00Z'));
    await act(() => result.current.submit());

    expect(plan).not.toHaveBeenCalled();
    expect(result.current.departure.error).toBe('Departure cannot be more than 1 hour in the past.');
  });

  it.each([
    ['departure', 'Departure cannot be more than 1 hour in the past.'],
    ['spacing_mi', 'Checkpoint spacing must be 10, 25 or 50 miles.'],
    ['origin.lat', 'Latitude must be between -90 and 90.'],
  ])('puts a server error on %s next to its field', async (field, message) => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError(message, 400, field));
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    const errors = {
      departure: result.current.departure.error,
      spacing_mi: result.current.spacing.error,
      'origin.lat': result.current.origin.error,
    };
    expect(errors[field as keyof typeof errors]).toBe(message);
    expect(result.current.error).toBeNull();
  });

  it('lists the selected route checkpoints with mile, local ETA and weather', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());

    expect(result.current.checkpoints).toBe(PLAN.routes[0].checkpoints);
    expect(result.current.timeline).toEqual([
      {
        index: 0,
        place: 'Start · Mile 0',
        eta: 'Sat 8:00 AM',
        weather: 'Overcast · Wind 10 mph · 31°F',
        kind: 'origin',
      },
      {
        index: 1,
        place: 'Mile 500',
        eta: 'Sat 3:45 PM',
        weather: 'Overcast · Wind 47 mph · 31°F',
        kind: 'stop',
      },
      {
        index: 2,
        place: 'Arrive · Mile 1,017',
        eta: 'Sat 11:45 PM',
        weather: 'Overcast · Wind 12 mph · 31°F',
        kind: 'destination',
      },
    ]);
    expect(result.current.selectedCheckpoint).toBeNull();

    act(() => result.current.selectRoute('B'));
    expect(result.current.checkpoints).toBe(PLAN.routes[1].checkpoints);
    expect(result.current.timeline[2].place).toBe('Arrive · Mile 1,059');
  });

  it('selects a checkpoint of the selected route and forgets it with another route', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());

    act(() => result.current.selectCheckpoint(1));
    expect(result.current.selectedCheckpoint).toBe(1);

    act(() => result.current.selectCheckpoint(9));
    expect(result.current.selectedCheckpoint).toBe(1);

    // Re-selecting the same route keeps the checkpoint; another route's index 1 is elsewhere.
    act(() => result.current.selectRoute('A'));
    expect(result.current.selectedCheckpoint).toBe(1);
    act(() => result.current.selectRoute('C'));
    expect(result.current.selectedCheckpoint).toBeNull();
  });

  it('closes the checkpoint details and names the route they belong to', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());
    expect(result.current.selectedRouteLabel).toBe('Route A');
    act(() => result.current.selectCheckpoint(1));

    act(() => result.current.clearCheckpoint());

    expect(result.current.selectedCheckpoint).toBeNull();
    act(() => result.current.selectRoute('B'));
    expect(result.current.selectedRouteLabel).toBe('Route B');
  });

  it('clears the checkpoint on a new plan', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());
    act(() => result.current.selectCheckpoint(2));

    await act(() => result.current.submit());

    expect(result.current.selectedCheckpoint).toBeNull();
  });
});

describe('weatherSummary', () => {
  it('names the condition, wind and temperature', () => {
    expect(weatherSummary(CALM)).toBe('Overcast · Wind 10 mph · 31°F');
  });

  it('adds rain and snow only when there is a measurable amount', () => {
    expect(weatherSummary({ ...CALM, rain_in_h: 0.004, snow_in_h: 0 })).toBe('Overcast · Wind 10 mph · 31°F');
    expect(weatherSummary({ ...CALM, weather_code: 73, rain_in_h: 0.02, snow_in_h: 0.37 })).toBe(
      'Snow · Wind 10 mph · Rain 0.02 in/h · Snow 0.37 in/h · 31°F',
    );
  });

  it('leaves out what the forecast does not have', () => {
    expect(weatherSummary({ ...CALM, weather_code: null, temp_f: null })).toBe('Wind 10 mph');
  });
});

describe('useTripPlannerViewModel layout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    clearPlaceSearchCache();
    vi.spyOn(api, 'geocode').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(result.current.tripLine).toEqual({ route: 'Chicago → Denver', details: 'Sat 8:00 AM' });
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
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError('Departure is too far ahead.', 400, 'departure'));
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    pickBoth(result);
    await act(() => result.current.submit());
    expect(result.current.formOpen).toBe(true);
    expect(result.current.departure.error).toBe('Departure is too far ahead.');
  });

  it('fills a sample trip and opens the form on it', () => {
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    act(() => result.current.fillExample());
    expect(result.current.formOpen).toBe(true);
    expect(result.current.origin.query).toBe('Chicago, Illinois, United States');
    expect(result.current.destination.query).toBe('Denver, Colorado, United States');
  });

  it('lowers a full sheet so a picked checkpoint shows on the map', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    pickBoth(result);
    await act(() => result.current.submit());
    expect(result.current.sheetSnap).toBe('half');

    act(() => result.current.setSheetSnap('full'));
    act(() => result.current.selectCheckpoint(1));
    expect(result.current.sheetSnap).toBe('half');
    expect(result.current.selectedCheckpoint).toBe(1);
  });

  it('closes what is open with Escape on a phone, the topmost first', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel({ layout: 'mobile' }));
    pickBoth(result);
    await act(() => result.current.submit());
    act(() => result.current.selectCheckpoint(1));
    act(() => result.current.openForm());

    const escape = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    escape();
    expect(result.current.formOpen).toBe(false);
    expect(result.current.selectedCheckpoint).toBe(1);
    escape();
    expect(result.current.selectedCheckpoint).toBeNull();
    expect(result.current.sheetSnap).toBe('half');
    escape();
    expect(result.current.sheetSnap).toBe('peek');
  });
});
