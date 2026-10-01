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
