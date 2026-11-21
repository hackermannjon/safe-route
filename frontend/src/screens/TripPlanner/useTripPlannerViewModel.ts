import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SheetSnap } from '../../components/BottomSheet';
import { formatDuration, formatMiles } from '../../lib/format';
import { ApiError, api, isAbortError } from '../../services/api';
import type { GeocodeResult, Place, PlanRequest, Route } from '../../types/api';
import { selectPlan, useTripStore } from '../../stores';
import { usePlaceSearch } from './usePlaceSearch';
import { useHistoryLayers, type HistoryLayers } from './useHistoryLayers';

type Endpoint = 'origin' | 'destination';
type Field = Endpoint;

const SERVER_FIELDS: Record<string, Field> = {
  origin: 'origin',
  destination: 'destination',
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
  via: string;
}

function summarize(route: Route): RouteSummary {
  return {
    id: route.id,
    label: route.label,
    distance: formatMiles(route.distance_mi),
    duration: formatDuration(route.duration_s),
    via: route.via.length ? `via ${route.via.join(', ')}` : '',
  };
}

const NO_ROUTES: Route[] = [];

/** The trip in one line, for the entry that opens the form: "Chicago → Denver". */
export interface TripLine {
  route: string;
}

/** Up to the first comma: "Chicago, Illinois, United States" reads "Chicago". */
const shortPlace = (label: string) => label.split(',')[0].trim();

function tripLine(origin: string, destination: string): TripLine {
  return {
    route: `${shortPlace(origin)} → ${shortPlace(destination)}`,
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
  // getState() returns a new object after every update, but the actions in it never change;
  // reading them once keeps every callback below stable.
  const store = useMemo(() => useTripStore.getState(), []);

  const routes = plan?.routes ?? NO_ROUTES;

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
      setFieldErrors(problems);
      if (!origin.selected || !destination.selected) return;

      await runPlan({
        origin: toPlace(origin.selected),
        destination: toPlace(destination.selected),
      });
    },
    [inputs, runPlan],
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

  const status: PlanStatus = planning ? 'loading' : error ? 'error' : routes.length > 0 ? 'ready' : 'idle';
  /** Anything past the empty start: a plan, its loading or its failure. */
  const hasResults = status !== 'idle';

  // On screen it names the plan that was made, not edits since; before one, it previews the form.
  const line = useMemo<TripLine | null>(() => {
    if (planned) return tripLine(planned.origin.label, planned.destination.label);
    const { origin, destination } = inputs;
    if (!origin.selected || !destination.selected) return null;
    return tripLine(origin.selected.label, destination.selected.label);
  }, [planned, inputs]);

  const onHistoryPop = useCallback(({ form, results }: HistoryLayers) => {
    setFormOpen(form);
    setSheetSnap((snap) => (results ? (snap === 'peek' ? 'half' : snap) : 'peek'));
  }, []);
  useHistoryLayers(mobile, { form: formOpen, results: hasResults && sheetSnap !== 'peek' }, onHistoryPop);

  // On a phone everything over the map closes with Escape, the topmost first, like Back does.
  const escapeState = useRef({ formOpen, sheetSnap });
  useEffect(() => {
    escapeState.current = { formOpen, sheetSnap };
  });
  useEffect(() => {
    if (!mobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A field that used Escape for itself (closing its suggestions) has already handled it.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const open = escapeState.current;
      if (open.formOpen) setFormOpen(false);
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
    planning,
    error,
    routes,
    summaries,
    /** The route's card, for the collapsed sheet. */
    summary: summaries[0] ?? null,
    routesHeading: summaries.length === 1 ? '1 route' : `${summaries.length} routes`,
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
