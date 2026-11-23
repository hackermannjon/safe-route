import type {
  ApiError as ApiErrorBody,
  GeocodeResult,
  HeatmapRequest,
  HeatmapResponse,
  PlanRequest,
  PlanResponse,
  RelayedForecast,
} from '../types/api';

// Empty means same origin: in development Vite proxies /api to Django, so the app
// also works when opened from another device on the network.
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

const OFFLINE_MESSAGE = "Can't reach the Safe Route server. Check your connection and try again.";

/**
 * A failed request with a message that is safe to show as is. `status` is 0
 * when the server could not be reached at all.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly field?: string;
  /** Forecast lookups the server could not make; see `withForecastRelay`. */
  readonly weatherRequests?: string[];

  constructor(message: string, status: number, field?: string, weatherRequests?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.weatherRequests = weatherRequests;
  }
}

/** Aborts are expected (a newer request replaced this one) and should be ignored, not shown. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && typeof (value as ApiErrorBody).error === 'string';
}

function fallbackMessage(status: number): string {
  if (status >= 500) return 'The server had a problem planning this trip. Try again in a moment.';
  if (status === 429) return 'Too many requests right now. Wait a few seconds and try again.';
  return 'The request could not be completed.';
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError(payload.error, response.status, payload.field, payload.weather_requests);
    }
    throw new ApiError(fallbackMessage(response.status), response.status);
  }
  if (payload === null) throw new ApiError('The server sent an empty response.', response.status);
  return payload as T;
}

export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const data = await request<{ results: GeocodeResult[] }>(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  return data.results;
}

function isForecastUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname.endsWith('/v1/forecast');
  } catch {
    return false;
  }
}

/** Only the hourly series is read back, so the rest of each answer is not sent. */
function hourlyOnly(location: unknown): unknown {
  return { hourly: (location as { hourly?: unknown } | null)?.hourly };
}

async function fetchForecast(url: string, signal?: AbortSignal): Promise<RelayedForecast> {
  if (!isForecastUrl(url)) throw new Error('Not a forecast URL.');
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const payload = await readJson(response);
  if (!response.ok || payload === null) throw new Error(`Forecast lookup failed (${response.status}).`);
  return { url, response: Array.isArray(payload) ? payload.map(hourlyOnly) : hourlyOnly(payload) };
}

/**
 * The forecast service meters requests per IP address, and the hosted server shares its address
 * with other apps, so its allowance can run out while each visitor still has their own. When that
 * happens the server lists the lookups it still needs; they are made from here and sent back with
 * the same request, once. If they fail too, the server's own message is the one shown.
 */
async function withForecastRelay<T, B extends object>(path: string, body: B, signal?: AbortSignal): Promise<T> {
  try {
    return await request<T>(path, { method: 'POST', body, signal });
  } catch (error) {
    if (!(error instanceof ApiError) || !error.weatherRequests?.length) throw error;
    let weather: RelayedForecast[];
    try {
      weather = await Promise.all(error.weatherRequests.map((url) => fetchForecast(url, signal)));
    } catch (relayError) {
      if (isAbortError(relayError)) throw relayError;
      throw error;
    }
    return request<T>(path, { method: 'POST', body: { ...body, weather }, signal });
  }
}

export function planTrip(body: PlanRequest, signal?: AbortSignal): Promise<PlanResponse> {
  return withForecastRelay('/api/plan', body, signal);
}

export function corridorHeatmap(body: HeatmapRequest, signal?: AbortSignal): Promise<HeatmapResponse> {
  return withForecastRelay('/api/heatmap', body, signal);
}

export const api = {
  geocode,
  plan: planTrip,
  heatmap: corridorHeatmap,
} as const;
