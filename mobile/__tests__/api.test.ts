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
