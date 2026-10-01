import request from 'supertest';
import { loadConfig } from '../src/config';

import { buildTestApp } from './helpers';

let app: Awaited<ReturnType<typeof buildTestApp>>['app'];
beforeAll(async () => {
  app = (await buildTestApp()).app;
});

describe('app', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON without leaking internals', async () => {
    const res = await request(app)
      .post('/v1/me')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
  });
});

describe('rate limiting', () => {
  it('returns 429 with the standard envelope once the limit is exceeded', async () => {
    const limited = (await buildTestApp({ RATE_LIMIT_PER_MINUTE: '3' })).app;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(limited).get('/v1/me')).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    const res = await request(limited).get('/v1/me');
    expect(res.body).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    expect((await request(limited).get('/health')).status).toBe(200); // health is exempt
  });
});

describe('loadConfig', () => {
  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
  it('requires Supabase settings in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SUPABASE_URL/);
  });
  it('parses CORS origins', () => {
    expect(loadConfig({ CORS_ORIGINS: 'https://a.com, https://b.com' }).CORS_ORIGINS).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});
