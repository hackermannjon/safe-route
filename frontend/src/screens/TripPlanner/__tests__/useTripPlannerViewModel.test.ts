import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../../services/api';
import type { Checkpoint, GeocodeResult, PlanResponse, RiskLevel, Route, Weather } from '../../../types/api';
import { riskSummary, useTripPlannerViewModel, weatherSummary } from '../useTripPlannerViewModel';
import { clearPlaceSearchCache } from '../usePlaceSearch';

const CHICAGO: GeocodeResult = { label: 'Chicago, Illinois, United States', name: 'Chicago', lat: 41.88, lon: -87.63 };
const DENVER: GeocodeResult = { label: 'Denver, Colorado, United States', name: 'Denver', lat: 39.74, lon: -104.99 };

// Tests run in America/Chicago (see vite.config.ts): 13:30 UTC is Sat 7:30 AM CST.
const NOW = new Date('2026-11-21T13:30:00Z');
const DEPARTURE = '2026-11-21T14:00:00Z';

const at = (seconds: number) => new Date(Date.parse(DEPARTURE) + seconds * 1000).toISOString().replace('.000', '');

const CALM: Weather = { wind_mph: 10, gust_mph: 18, rain_in_h: 0, snow_in_h: 0, temp_f: 31.4, weather_code: 3 };

// The middle checkpoint of every route is windy enough that heavy cargo raised it.
const MIDDLE: Pick<Checkpoint, 'level' | 'factor' | 'load_rule'> = {
  level: 'NO_TRAVEL',
  factor: 'load',
  load_rule: 'Wind 45 to under 55 mph with cargo over 30,000 lb',
};
const CALM_POINT: Pick<Checkpoint, 'level' | 'factor' | 'load_rule'> = {
  level: 'LOW',
  factor: 'wind',
  load_rule: null,
};

function route(id: string, distance_mi: number, duration_s: number, via: string[], rank = 1, reason = ''): Route {
  // Constant speed, checkpoints every 500 mi; enough to tell the routes apart.
  const miles = [0, 500, distance_mi];
  const levelMiles: Record<RiskLevel, number> = { LOW: 0, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: distance_mi };
  return {
    id,
    label: `Route ${id}`,
    rank,
    recommended: rank === 1,
    rank_reason: reason,
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
      ...(index === 1 ? MIDDLE : CALM_POINT),
      weather: { ...CALM, wind_mph: index === 1 ? 47 : 10 + index },
    })),
    risk: { worst_level: 'NO_TRAVEL', avg_risk: 4, miles: levelMiles },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-87.63, 41.88],
        [-104.99, 39.74],
      ],
    },
    segments: { type: 'FeatureCollection', features: [] },
  };
}

const PLAN: PlanResponse = {
  departure: DEPARTURE,
  cargo_lb: 42_000,
  spacing_mi: 25,
  recommended_route_id: 'A',
  notices: [],
  routes: [
    route('A', 1016.6, 56739, ['I-88', 'I-80', 'I-76'], 1, 'Same risk as the other routes and the fastest.'),
    route('B', 1058.8, 59760, ['US-20', 'I-80', 'I-76'], 2, 'Same risk as Route A but 50 min longer.'),
    route('C', 1116.3, 62640, [], 3, 'Same risk as Route A but 1 h 38 min longer.'),
  ],
};

// The fastest route, A, crosses the worst weather, so the ranking differs from the id order.
const RANKED: PlanResponse = {
  ...PLAN,
  recommended_route_id: 'B',
  routes: [
    route('A', 1016.6, 56739, ['I-88', 'I-80', 'I-76'], 3, '120 more miles in High risk than Route B.'),
    route('B', 1058.8, 59760, ['US-20', 'I-80', 'I-76'], 1, 'The only route with no miles at High risk or worse.'),
    route('C', 1116.3, 62640, [], 2, '40 more miles in High risk than Route B.'),
  ],
};

function pickBoth(result: { current: ReturnType<typeof useTripPlannerViewModel> }, cargo: number | null = 42_000) {
  act(() => result.current.origin.onSelect(CHICAGO));
  act(() => result.current.destination.onSelect(DENVER));
  act(() => result.current.cargo.onChange(cargo));
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
        cargo_lb: 42_000,
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
      risk: { level: 'NO_TRAVEL', miles: PLAN.routes[0].risk.miles },
      recommended: true,
      reason: 'Same risk as the other routes and the fastest.',
    });
    expect(result.current.showLegend).toBe(true);
    expect(result.current.summaries[2].via).toBe('');
    expect(result.current.notices).toEqual([]);
    expect(result.current.planning).toBe(false);
  });

  it('lists the routes best first and selects the recommended one', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(RANKED);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    expect(result.current.summaries.map((s) => s.id)).toEqual(['B', 'C', 'A']);
    expect(result.current.summaries.map((s) => s.recommended)).toEqual([true, false, false]);
    expect(result.current.summaries.map((s) => s.reason)).toEqual([
      'The only route with no miles at High risk or worse.',
      '40 more miles in High risk than Route B.',
      '120 more miles in High risk than Route B.',
    ]);
    expect(result.current.selectedRouteId).toBe('B');
    expect(result.current.checkpoints).toBe(RANKED.routes[1].checkpoints);
    // The map keeps the plan's own list; only the cards are reordered.
    expect(result.current.routes).toBe(RANKED.routes);
  });

  it('summarizes the recommended route, whichever route is selected', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue(RANKED);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    expect(result.current.summary).toBeNull();

    await act(() => result.current.submit());
    act(() => result.current.selectRoute('A'));

    expect(result.current.summary).toEqual({
      route: 'Route B',
      distance: '1,059 mi',
      duration: '16 h 36 min',
      arrival: 'Arrives Sun 12:36 AM',
      level: 'NO_TRAVEL',
    });
  });

  it('falls back to the top rank when the recommended id is not in the plan', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue({ ...RANKED, recommended_route_id: 'Z' });
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    expect(result.current.selectedRouteId).toBe('B');
    expect(result.current.summary?.route).toBe('Route B');
  });

  it('drops the summary when a new plan fails', async () => {
    const plan = vi.spyOn(api, 'plan').mockResolvedValue(RANKED);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);
    await act(() => result.current.submit());

    plan.mockRejectedValue(new ApiError('Weather service is unavailable.', 502));
    await act(() => result.current.submit());

    expect(result.current.summary).toBeNull();
    expect(result.current.summaries).toEqual([]);
  });

  it('selects the recommended route by default and switches on request', async () => {
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

  it('starts with an empty cargo field and asks for it before planning', async () => {
    const plan = vi.spyOn(api, 'plan');
    const { result } = renderHook(() => useTripPlannerViewModel());
    expect(result.current.cargo.value).toBeNull();
    expect(result.current.cargo.unit).toBe('lb');
    expect(result.current.showLegend).toBe(false);
    pickBoth(result, null);

    await act(() => result.current.submit());

    expect(plan).not.toHaveBeenCalled();
    expect(result.current.cargo.error).toBe('Enter the cargo weight.');
    act(() => result.current.cargo.onChange(0));
    expect(result.current.cargo.error).toBeUndefined();
  });

  it('flags cargo over 80,000 lb as it is typed and refuses to plan with it', async () => {
    const plan = vi.spyOn(api, 'plan');
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result, 8_000);
    expect(result.current.cargo.error).toBeUndefined();

    act(() => result.current.cargo.onChange(80_001));
    expect(result.current.cargo.error).toBe('Cargo weight cannot exceed 80,000 lb.');
    await act(() => result.current.submit());
    expect(plan).not.toHaveBeenCalled();

    act(() => result.current.cargo.onChange(80_000));
    expect(result.current.cargo.error).toBeUndefined();
  });

  it.each([0, 5_000, 80_000])('sends %d lb of cargo', async (cargo) => {
    const plan = vi.spyOn(api, 'plan').mockResolvedValue(PLAN);
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result, cargo);

    await act(() => result.current.submit());

    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ cargo_lb: cargo }), expect.any(AbortSignal));
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
    ['cargo_lb', 'Cargo weight cannot exceed 80,000 lb.'],
    ['origin.lat', 'Latitude must be between -90 and 90.'],
  ])('puts a server error on %s next to its field', async (field, message) => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError(message, 400, field));
    const { result } = renderHook(() => useTripPlannerViewModel());
    pickBoth(result);

    await act(() => result.current.submit());

    const errors = {
      departure: result.current.departure.error,
      spacing_mi: result.current.spacing.error,
      cargo_lb: result.current.cargo.error,
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
        level: 'LOW',
        risk: 'Low',
        loadRule: null,
        kind: 'origin',
      },
      {
        index: 1,
        place: 'Mile 500',
        eta: 'Sat 3:45 PM',
        weather: 'Overcast · Wind 47 mph · 31°F',
        level: 'NO_TRAVEL',
        risk: 'No Travel · Wind with this load',
        loadRule: 'Wind 45 to under 55 mph with cargo over 30,000 lb',
        kind: 'stop',
      },
      {
        index: 2,
        place: 'Arrive · Mile 1,017',
        eta: 'Sat 11:45 PM',
        weather: 'Overcast · Wind 12 mph · 31°F',
        level: 'LOW',
        risk: 'Low',
        loadRule: null,
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

describe('riskSummary', () => {
  it('names the level and what set it', () => {
    expect(riskSummary({ level: 'HIGH', factor: 'rain' })).toBe('High · Rain');
    expect(riskSummary({ level: 'SEVERE', factor: 'snow' })).toBe('Severe · Snow');
    expect(riskSummary({ level: 'NO_TRAVEL', factor: 'load' })).toBe('No Travel · Wind with this load');
  });

  it('names no factor when the level is Low', () => {
    expect(riskSummary({ level: 'LOW', factor: 'wind' })).toBe('Low');
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
    expect(result.current.tripLine).toEqual({ route: 'Chicago → Denver', details: 'Sat 8:00 AM · 42,000 lb' });
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
    expect(result.current.cargo.value).toBe(42_000);
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
