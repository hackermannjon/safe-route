import { useEffect, useState } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { api, isAbortError } from '../../services/api';
import type { GeocodeResult } from '../../types/api';

export const GEOCODE_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const EMPTY: GeocodeResult[] = [];

// Typing back over a prefix ("Chi" -> "Chica" -> "Chi") should not refetch.
const cache = new Map<string, GeocodeResult[]>();

export function clearPlaceSearchCache() {
  cache.clear();
}

interface SearchState {
  query: string;
  results: GeocodeResult[];
  failed: boolean;
}

/**
 * Debounced autocomplete. `selectedLabel` suppresses the search once the user
 * has picked a suggestion, because the input then holds that suggestion's label.
 */
export function usePlaceSearch(query: string, selectedLabel: string | null) {
  const trimmed = query.trim();
  const active = trimmed.length >= MIN_QUERY && query !== selectedLabel;
  const debounced = useDebounce(active ? trimmed : '', GEOCODE_DEBOUNCE_MS);
  const [state, setState] = useState<SearchState>({ query: '', results: EMPTY, failed: false });

  const cached = debounced ? cache.get(debounced.toLowerCase()) : undefined;

  useEffect(() => {
    const key = debounced.toLowerCase();
    if (!debounced || cache.has(key)) return;
    const controller = new AbortController();
    api
      .geocode(debounced, controller.signal)
      .then((results) => {
        cache.set(key, results);
        setState({ query: debounced, results, failed: false });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setState({ query: debounced, results: EMPTY, failed: true });
      });
    return () => controller.abort();
  }, [debounced]);

  // Results are only shown for the query they answer, so stale lists never flash.
  const current = active && debounced === trimmed;
  if (current && cached) return { results: cached, loading: false, failed: false };
  const fresh = current && state.query === debounced;
  return {
    results: fresh ? state.results : EMPTY,
    loading: active && !fresh,
    failed: fresh && state.failed,
  };
}
