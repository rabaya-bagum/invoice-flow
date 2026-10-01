import { SignJWT, generateKeyPair } from 'jose';
import request from 'supertest';
import { buildTestApp, ISSUER, sign, USER_A, USER_B } from './helpers';

describe('authentication', () => {
  it('rejects requests with no token', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects garbage and non-bearer headers', async () => {
    const { app } = await buildTestApp();
    expect((await request(app).get('/v1/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await request(app).get('/v1/me').set('Authorization', 'Basic abc')).status).toBe(401);
  });

  it('accepts a valid token', async () => {
    const { app, privateKey } = await buildTestApp();
    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${await sign(privateKey)}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(USER_A);
    expect(res.body.business.name).toBe('alice Co');
  });

  it.each([
    ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['wrong audience', { aud: 'anon' }],
    ['wrong issuer', { iss: 'https://evil.example/auth/v1' }],
    ['non-uuid subject', { sub: 'admin' }],
  ])('rejects a token that is %s', async (_n, claims) => {
    const { app, privateKey } = await buildTestApp();
    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${await sign(privateKey, claims)}`);
    expect(res.status).toBe(401);
    // Every failure looks identical: never reveal why verification failed.
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Session expired or invalid' },
    });
  });

  it('rejects a token signed with a different key', async () => {
    const { app } = await buildTestApp();
    const other = await generateKeyPair('ES256');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(USER_A)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(other.privateKey);
    expect((await request(app).get('/v1/me').set('Authorization', `Bearer ${token}`)).status).toBe(
      401,
    );
  });

  it('rejects alg=none tokens', async () => {
    const { app } = await buildTestApp();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({ sub: USER_A, iss: ISSUER, aud: 'authenticated' })}.`;
    expect((await request(app).get('/v1/me').set('Authorization', `Bearer ${token}`)).status).toBe(
      401,
    );
  });
});

describe('GET /v1/me', () => {
  it("returns only the caller's own account", async () => {
    const { app, privateKey } = await buildTestApp();
    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${await sign(privateKey, { sub: USER_B, email: 'b@x.com' })}`);
    expect(res.body.user.id).toBe(USER_B);
    expect(res.body.business.id).toBe(`biz-${USER_B}`);
    expect(res.body.email).toBe('b@x.com');
  });

  it('404s when a verified user has no account row', async () => {
    const { app, privateKey } = await buildTestApp();
    const res = await request(app)
      .get('/v1/me')
      .set(
        'Authorization',
        `Bearer ${await sign(privateKey, { sub: '33333333-3333-4333-8333-333333333333' })}`,
      );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('DELETE /v1/me', () => {
  it('requires explicit confirmation', async () => {
    const { app, privateKey, deleted } = await buildTestApp();
    const res = await request(app)
      .delete('/v1/me')
      .set('Authorization', `Bearer ${await sign(privateKey)}`)
      .send({});
    expect(res.status).toBe(400);
    expect(deleted).toEqual([]);
  });

  it('writes an audit entry then deletes only the caller', async () => {
    const { app, privateKey, deleted, audit } = await buildTestApp();
    const res = await request(app)
      .delete('/v1/me')
      .set('Authorization', `Bearer ${await sign(privateKey)}`)
      .send({ confirm: 'DELETE' });
    expect(res.status).toBe(204);
    expect(deleted).toEqual([USER_A]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'account.delete', userId: USER_A });
  });
});
