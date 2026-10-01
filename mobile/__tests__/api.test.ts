import { ApiError, createApiClient } from '../src/services/api';

const json = (status: number, body?: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

function setup(responses: Array<Response | Error>) {
  const seen: Array<string | undefined> = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).Authorization);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next as Response;
  }) as unknown as typeof fetch;
  const onSessionExpired = jest.fn();
  const refreshToken = jest.fn(async () => 'fresh');
  const client = createApiClient({
    baseUrl: 'http://api',
    getToken: async () => 'old',
    refreshToken,
    onSessionExpired,
    fetchImpl,
  });
  return { client, seen, onSessionExpired, refreshToken };
}

describe('api client', () => {
  it('sends the bearer token', async () => {
    const { client, seen } = setup([json(200, { user: {} })]);
    await client.getMe();
    expect(seen).toEqual(['Bearer old']);
  });

  it('refreshes once on 401 and retries', async () => {
    const { client, seen, onSessionExpired } = setup([json(401), json(200, { ok: 1 })]);
    await client.getMe();
    expect(seen).toEqual(['Bearer old', 'Bearer fresh']);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('expires the session if the retry is also 401', async () => {
    const { client, onSessionExpired } = setup([json(401), json(401)]);
    await expect(client.getMe()).rejects.toMatchObject({ kind: 'session_expired' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('maps network failures and server errors to friendly kinds', async () => {
    const net = setup([new TypeError('Network request failed')]);
    await expect(net.client.getMe()).rejects.toMatchObject({ kind: 'network' });
    const srv = setup([json(500, { error: { code: 'INTERNAL' } })]);
    const err = await srv.client.getMe().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'server', status: 500, code: 'INTERNAL' });
  });

  it('handles 204 on account deletion and sends the confirmation', async () => {
    let body: unknown;
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      refreshToken: async () => null,
      onSessionExpired: () => {},
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        body = init?.body;
        return json(204);
      }) as unknown as typeof fetch,
    });
    await expect(client.deleteAccount()).resolves.toBeUndefined();
    expect(JSON.parse(body as string)).toEqual({ confirm: 'DELETE' });
  });
});

describe('api client: catalog calls', () => {
  function capture() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      refreshToken: async () => null,
      onSessionExpired: () => {},
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return json(200, { items: [], total: 0 });
      }) as unknown as typeof fetch,
    });
    return { client, calls };
  }

  it('encodes search text and omits empty params', async () => {
    const { client, calls } = capture();
    await client.listCustomers({ search: "O'Brien & Sons/100%", limit: 25, offset: 0 });
    await client.listProducts({ search: '', limit: 25, offset: 50, includeInactive: true });
    expect(calls[0]?.url).toBe(
      "http://api/v1/customers?search=O'Brien%20%26%20Sons%2F100%25&limit=25&offset=0",
    );
    expect(calls[1]?.url).toBe('http://api/v1/products?limit=25&offset=50&includeInactive=true');
  });

  it('uses PUT with a JSON body for updates and DELETE without one', async () => {
    const { client, calls } = capture();
    await client.updateBusiness({ name: 'X' });
    await client.deleteCustomer('c1');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ name: 'X' });
    expect(calls[1]?.init).toMatchObject({ method: 'DELETE' });
    expect(calls[1]?.url).toBe('http://api/v1/customers/c1');
  });
});
