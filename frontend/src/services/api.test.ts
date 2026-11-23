import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, ApiError, api, isAbortError } from './api';

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('returns geocode results and encodes the query', async () => {
    const fetchMock = respond(200, {
      results: [{ label: 'Chicago, Illinois', name: 'Chicago', lat: 41.87, lon: -87.62 }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await api.geocode('st. louis & co');
    expect(results).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/geocode?q=st.%20louis%20%26%20co`);
  });

  it('surfaces the server message and field as an ApiError', async () => {
    vi.stubGlobal('fetch', respond(400, { error: 'Choose an origin.', field: 'origin' }));
    const error = await api.plan({} as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: 'Choose an origin.',
      field: 'origin',
      status: 400,
    });
  });

  it('falls back to a readable message when the body is not the error shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(api.plan({} as never)).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/try again/i),
    });
  });

  it('reports an unreachable server with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.plan({} as never)).rejects.toMatchObject({ status: 0, name: 'ApiError' });
  });

  it('passes aborts through untouched so callers can ignore them', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    const controller = new AbortController();
    const error = await api.geocode('chi', controller.signal).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
  });

  it('sends JSON for POST requests', async () => {
    const fetchMock = respond(200, { routes: [] });
    vi.stubGlobal('fetch', fetchMock);
    await api.plan({ origin: { lat: 1, lon: 2, label: '' } } as never);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"origin":{"lat":1,"lon":2,"label":""}}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });
  it('posts the routes for the corridor heatmap', async () => {
    const fetchMock = respond(200, { cells: [] });
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      departure: '2026-11-21T14:00:00Z',
      cargo_lb: 0,
      routes: [
        [
          [-87.6, 41.9],
          [-88, 41.5],
        ],
      ],
    };
    await api.heatmap(body);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/api/heatmap`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  describe('when the server has no forecast allowance left', () => {
    const forecastUrl = 'https://api.open-meteo.com/v1/forecast?latitude=41.9&longitude=-87.6';
    const spent = { error: 'The daily limit has been reached.', weather_requests: [forecastUrl] };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

    it('looks the forecast up from the browser and repeats the request with it', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(502, spent))
        .mockResolvedValueOnce(json(200, { latitude: 41.9, hourly: { time: [] }, hourly_units: {} }))
        .mockResolvedValueOnce(json(200, { routes: [] }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(api.plan({ cargo_lb: 0 } as never)).resolves.toEqual({ routes: [] });
      expect(fetchMock.mock.calls[1][0]).toBe(forecastUrl);
      const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(url).toBe(`${API_BASE_URL}/api/plan`);
      expect(JSON.parse(init.body as string)).toEqual({
        cargo_lb: 0,
        weather: [{ url: forecastUrl, response: { hourly: { time: [] } } }],
      });
    });

    it("shows the server's message when the browser cannot look it up either", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(502, spent))
        .mockResolvedValueOnce(json(429, { error: true, reason: 'Daily API request limit exceeded.' }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(api.heatmap({} as never)).rejects.toMatchObject({ status: 502, message: spent.error });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('never fetches a lookup that is not a forecast URL', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(502, { ...spent, weather_requests: ['http://example.com/v1/forecast'] }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(api.plan({} as never)).rejects.toMatchObject({ message: spent.error });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('asks only once', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(502, spent))
        .mockResolvedValueOnce(json(200, { hourly: { time: [] } }))
        .mockResolvedValueOnce(json(502, spent));
      vi.stubGlobal('fetch', fetchMock);
      await expect(api.plan({} as never)).rejects.toMatchObject({ weatherRequests: [forecastUrl] });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
