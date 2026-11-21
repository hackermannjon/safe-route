import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SheetSnap } from '../../components/BottomSheet';
import type { TimelineItem } from '../../components/CheckpointTimeline';
import {
  formatDuration,
  formatEta,
  formatMilepost,
  formatMiles,
  formatRate,
  formatTemp,
  formatWind,
  isMeasurable,
} from '../../lib/format';
import { weatherCondition } from '../../lib/weatherCodes';
import { ApiError, api, isAbortError } from '../../services/api';
import type { Checkpoint, GeocodeResult, Place, PlanRequest, Route, SpacingMi, Weather } from '../../types/api';
import {
  DEFAULT_SPACING,
  SPACING_OPTIONS,
  departureBounds,
  departureError,
  localInputToIso,
  nextWholeHour,
  parseLocalInput,
  toLocalInputValue,
  zoneName,
} from './formModel';
import { selectPlan, selectSelectedCheckpoint, selectSelectedRouteId, useTripStore } from '../../stores';
import { usePlaceSearch } from './usePlaceSearch';
import { useHistoryLayers, type HistoryLayers } from './useHistoryLayers';

type Endpoint = 'origin' | 'destination';
type Field = Endpoint | 'departure' | 'spacing';

const SERVER_FIELDS: Record<string, Field> = {
  origin: 'origin',
  destination: 'destination',
  departure: 'departure',
  spacing_mi: 'spacing',
};

/** The API may point inside a field ("origin.lat"); the form only knows the top-level input. */
function fieldFromServer(field: string | undefined): Field | null {
  const root = field?.split('.')[0];
  return (root && SERVER_FIELDS[root]) || null;
}

interface PlaceInput {
  query: string;
  selected: GeocodeResult | null;
}

const EMPTY_INPUT: PlaceInput = { query: '', selected: null };

function toPlace({ lat, lon, label }: GeocodeResult): Place {
  return { lat, lon, label };
}

export interface RouteSummary {
  id: string;
  label: string;
  distance: string;
  duration: string;
  /** "Arrives Sat 11:40 PM", in the driver's zone. */
  arrival: string;
  via: string;
}

function summarize(route: Route): RouteSummary {
  return {
    id: route.id,
    label: route.label,
    distance: formatMiles(route.distance_mi),
    duration: formatDuration(route.duration_s),
    arrival: `Arrives ${formatEta(route.arrival)}`,
    via: route.via.length ? `via ${route.via.join(', ')}` : '',
  };
}

const NO_CHECKPOINTS: Checkpoint[] = [];
const NO_ROUTES: Route[] = [];
const NO_NOTICES: string[] = [];

/** Dry readings are left out so the precipitation that is there stands out. */
export function weatherSummary(weather: Weather): string {
  const parts = [weatherCondition(weather.weather_code), `Wind ${formatWind(weather.wind_mph)}`];
  if (isMeasurable(weather.rain_in_h)) parts.push(`Rain ${formatRate(weather.rain_in_h)}`);
  if (isMeasurable(weather.snow_in_h)) parts.push(`Snow ${formatRate(weather.snow_in_h)}`);
  if (weather.temp_f !== null) parts.push(formatTemp(weather.temp_f));
  return parts.filter(Boolean).join(' · ');
}

function timelineItems(checkpoints: readonly Checkpoint[]): TimelineItem[] {
  const last = checkpoints.length - 1;
  return checkpoints.map((cp, i) => ({
    index: cp.index,
    place: i === 0 ? 'Start · Mile 0' : i === last ? `Arrive · ${formatMilepost(cp.mile)}` : formatMilepost(cp.mile),
    eta: formatEta(cp.eta),
    weather: weatherSummary(cp.weather),
    kind: i === 0 ? 'origin' : i === last ? 'destination' : 'stop',
  }));
}

/** The trip in one line, for the entry that opens the form: "Chicago → Denver". */
export interface TripLine {
  route: string;
  /** "Sat 8:00 AM" */
  details: string;
}

/** Up to the first comma: "Chicago, Illinois, United States" reads "Chicago". */
const shortPlace = (label: string) => label.split(',')[0].trim();

function tripLine(origin: string, destination: string, departureIso: string | null): TripLine {
  return {
    route: `${shortPlace(origin)} → ${shortPlace(destination)}`,
    details: departureIso ? formatEta(departureIso) : '',
  };
}

/** A trip anyone can try without knowing a place name: the API contract's own example. */
const EXAMPLE_TRIP = {
  origin: { label: 'Chicago, Illinois, United States', name: 'Chicago', lat: 41.8755, lon: -87.6244 },
  destination: { label: 'Denver, Colorado, United States', name: 'Denver', lat: 39.7392, lon: -104.9849 },
} satisfies { origin: GeocodeResult; destination: GeocodeResult };

export type PlanStatus = 'idle' | 'loading' | 'error' | 'ready';

export interface TripPlannerOptions {
  /**
   * On a phone the form and the results sheet cover the map, so they get history entries for
   * the Back gesture.
   */
  layout?: 'mobile' | 'desktop';
}

export function useTripPlannerViewModel({ layout = 'desktop' }: TripPlannerOptions = {}) {
  const mobile = layout === 'mobile';
  const [inputs, setInputs] = useState<Record<Endpoint, PlaceInput>>({
    origin: EMPTY_INPUT,
    destination: EMPTY_INPUT,
  });
  const [departure, setDeparture] = useState(() => toLocalInputValue(nextWholeHour(new Date())));
  const [spacing, setSpacing] = useState<SpacingMi>(DEFAULT_SPACING);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lastRequest = useRef<PlanRequest | null>(null);
  /** The request behind the plan on screen, which the trip line describes. */
  const [planned, setPlanned] = useState<PlanRequest | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');

  const plan = useTripStore(selectPlan);
  const selectedRouteId = useTripStore(selectSelectedRouteId);
  const selectedCheckpoint = useTripStore(selectSelectedCheckpoint);
  // getState() returns a new object after every update, but the actions in it never change;
  // reading them once keeps every callback below stable.
  const store = useMemo(() => useTripStore.getState(), []);

  const routes = plan?.routes ?? NO_ROUTES;
  const notices = plan?.notices ?? NO_NOTICES;

  useEffect(() => () => requestRef.current?.abort(), []);

  const originSearch = usePlaceSearch(inputs.origin.query, inputs.origin.selected?.label ?? null);
  const destinationSearch = usePlaceSearch(inputs.destination.query, inputs.destination.selected?.label ?? null);

  const setQuery = useCallback((endpoint: Endpoint, query: string) => {
    setInputs((prev) => ({
      ...prev,
      // Editing the text after a pick means the pick no longer stands.
      [endpoint]: { query, selected: prev[endpoint].selected?.label === query ? prev[endpoint].selected : null },
    }));
    setFieldErrors((prev) => ({ ...prev, [endpoint]: undefined }));
  }, []);

  const select = useCallback((endpoint: Endpoint, result: GeocodeResult) => {
    setInputs((prev) => ({ ...prev, [endpoint]: { query: result.label, selected: result } }));
    setFieldErrors((prev) => ({ ...prev, [endpoint]: undefined }));
  }, []);

  const changeDeparture = useCallback((value: string) => {
    setDeparture(value);
    setFieldErrors((prev) => ({ ...prev, departure: undefined }));
  }, []);

  const changeSpacing = useCallback((value: SpacingMi) => {
    setSpacing(value);
    setFieldErrors((prev) => ({ ...prev, spacing: undefined }));
  }, []);

  const runPlan = useCallback(
    async (request: PlanRequest) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      lastRequest.current = request;
      setPlanning(true);
      setError(null);
      setFormOpen(false);
      setSheetSnap('half');
      try {
        const next = await api.plan(request, controller.signal);
        // A newer request may have started while this response was being read.
        if (controller.signal.aborted) return;
        store.setPlan(next);
        setPlanned(request);
        if (!next.routes.length) setError('No route was found for this trip.');
      } catch (err) {
        if (isAbortError(err)) return;
        const apiError = err instanceof ApiError ? err : null;
        const message = apiError?.message ?? 'Something went wrong. Try again.';
        const field = fieldFromServer(apiError?.field);
        if (field) {
          setFieldErrors({ [field]: message });
          // The fix is in the form, so it opens again with the field marked.
          setFormOpen(true);
        } else {
          setError(message);
        }
        store.clearPlan();
        setPlanned(null);
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setPlanning(false);
        }
      }
    },
    [store],
  );

  const submit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const { origin, destination } = inputs;
      const problems: Partial<Record<Field, string>> = {};
      if (!origin.selected) problems.origin = 'Pick a starting point from the list.';
      if (!destination.selected) problems.destination = 'Pick a destination from the list.';
      const departureProblem = departureError(departure, new Date());
      if (departureProblem) problems.departure = departureProblem;
      setFieldErrors(problems);
      const departureIso = localInputToIso(departure);
      if (!origin.selected || !destination.selected || departureProblem || !departureIso) return;

      await runPlan({
        origin: toPlace(origin.selected),
        destination: toPlace(destination.selected),
        departure: departureIso,
        spacing_mi: spacing,
      });
    },
    [inputs, departure, spacing, runPlan],
  );

  /** Sends the last request again, for failures the form cannot fix (timeouts, upstream errors). */
  const retry = useCallback(() => {
    if (lastRequest.current) void runPlan(lastRequest.current);
  }, [runPlan]);

  const dismissError = useCallback(() => setError(null), []);
  const openForm = useCallback(() => setFormOpen(true), []);
  const closeForm = useCallback(() => setFormOpen(false), []);

  const fillExample = useCallback(() => {
    setInputs({
      origin: { query: EXAMPLE_TRIP.origin.label, selected: EXAMPLE_TRIP.origin },
      destination: { query: EXAMPLE_TRIP.destination.label, selected: EXAMPLE_TRIP.destination },
    });
    setFieldErrors({});
    setFormOpen(true);
  }, []);

  const summaries = useMemo(() => routes.map(summarize), [routes]);
  const checkpoints = useMemo(
    () => routes.find((route) => route.id === selectedRouteId)?.checkpoints ?? NO_CHECKPOINTS,
    [routes, selectedRouteId],
  );
  const timeline = useMemo(() => timelineItems(checkpoints), [checkpoints]);

  const selectRoute = useCallback((id: string) => store.selectRoute(id), [store]);
  const selectCheckpoint = useCallback(
    (index: number) => {
      if (!checkpoints.some((cp) => cp.index === index)) return;
      store.selectCheckpoint(index);
      // A full sheet hides the map, where the checkpoint's details open.
      setSheetSnap((snap) => (snap === 'full' ? 'half' : snap));
    },
    [checkpoints, store],
  );
  const clearCheckpoint = useCallback(() => store.selectCheckpoint(null), [store]);
  const selectedRouteLabel = routes.find((route) => route.id === selectedRouteId)?.label ?? '';
  // Picker bounds and zone name only guide the input; they need not tick with the clock.
  const [openedAt] = useState(() => new Date());
  const bounds = useMemo(() => departureBounds(openedAt), [openedAt]);
  const departureDate = parseLocalInput(departure);

  const status: PlanStatus = planning ? 'loading' : error ? 'error' : routes.length > 0 ? 'ready' : 'idle';
  /** Anything past the empty start: a plan, its loading or its failure. */
  const hasResults = status !== 'idle';

  // On screen it names the plan that was made, not edits since; before one, it previews the form.
  const line = useMemo<TripLine | null>(() => {
    if (planned) return tripLine(planned.origin.label, planned.destination.label, planned.departure);
    const { origin, destination } = inputs;
    if (!origin.selected || !destination.selected) return null;
    return tripLine(origin.selected.label, destination.selected.label, localInputToIso(departure));
  }, [planned, inputs, departure]);

  const onHistoryPop = useCallback(({ form, results }: HistoryLayers) => {
    setFormOpen(form);
    setSheetSnap((snap) => (results ? (snap === 'peek' ? 'half' : snap) : 'peek'));
  }, []);
  useHistoryLayers(mobile, { form: formOpen, results: hasResults && sheetSnap !== 'peek' }, onHistoryPop);

  // On a phone everything over the map closes with Escape, the topmost first, like Back does.
  const escapeState = useRef({ formOpen, selectedCheckpoint, sheetSnap });
  useEffect(() => {
    escapeState.current = { formOpen, selectedCheckpoint, sheetSnap };
  });
  useEffect(() => {
    if (!mobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A field that used Escape for itself (closing its suggestions) has already handled it.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const open = escapeState.current;
      if (open.formOpen) setFormOpen(false);
      else if (open.selectedCheckpoint !== null) useTripStore.getState().selectCheckpoint(null);
      else if (open.sheetSnap !== 'peek') setSheetSnap('peek');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobile]);

  return {
    origin: {
      query: inputs.origin.query,
      resolved: inputs.origin.selected !== null,
      suggestions: originSearch.results,
      searching: originSearch.loading,
      searchFailed: originSearch.failed,
      error: fieldErrors.origin,
      onQueryChange: (query: string) => setQuery('origin', query),
      onSelect: (result: GeocodeResult) => select('origin', result),
    },
    destination: {
      query: inputs.destination.query,
      resolved: inputs.destination.selected !== null,
      suggestions: destinationSearch.results,
      searching: destinationSearch.loading,
      searchFailed: destinationSearch.failed,
      error: fieldErrors.destination,
      onQueryChange: (query: string) => setQuery('destination', query),
      onSelect: (result: GeocodeResult) => select('destination', result),
    },
    departure: {
      value: departure,
      min: bounds.min,
      max: bounds.max,
      hint: `Your local time (${zoneName(departureDate ?? openedAt)})`,
      error: fieldErrors.departure,
      onChange: changeDeparture,
    },
    spacing: {
      value: spacing,
      options: SPACING_OPTIONS,
      error: fieldErrors.spacing,
      onChange: changeSpacing,
    },
    planning,
    error,
    routes,
    summaries,
    /** The selected route's card, for the collapsed sheet. */
    selectedSummary: summaries.find((route) => route.id === selectedRouteId) ?? null,
    routesHeading: summaries.length === 1 ? '1 route' : `${summaries.length} routes`,
    notices,
    selectedRouteId,
    selectRoute,
    /** The selected route's checkpoints, for the map. */
    checkpoints,
    timeline,
    selectedCheckpoint,
    selectCheckpoint,
    clearCheckpoint,
    selectedRouteLabel,
    submit,
    status,
    hasResults,
    retry,
    dismissError,
    /** The trip as one line, or null before both places are picked. */
    tripLine: line,
    fillExample,
    /** The phone's full-screen form. */
    formOpen,
    /** The desktop panel shows the form until there is a plan, then a line that reopens it. */
    formExpanded: formOpen || status === 'idle' || (status === 'error' && routes.length === 0),
    openForm,
    closeForm,
    sheetSnap,
    setSheetSnap,
  };
}

export type TripPlannerViewModel = ReturnType<typeof useTripPlannerViewModel>;
