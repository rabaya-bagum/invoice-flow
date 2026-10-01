import { classifyError, friendlyMessage } from '../src/utils/errors';

describe('error mapping', () => {
  it.each([
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'invalid_credentials'],
    [{ code: 'email_not_confirmed' }, 'email_not_verified'],
    [{ code: 'over_email_send_rate_limit' }, 'rate_limited'],
    [{ status: 429 }, 'rate_limited'],
    [{ code: 'weak_password' }, 'weak_password'],
    [{ code: 'refresh_token_not_found' }, 'session_expired'],
    [{ status: 401 }, 'session_expired'],
    [{ name: 'AuthRetryableFetchError', message: 'x' }, 'network'],
    [new TypeError('Network request failed'), 'network'],
    [{ status: 503 }, 'server'],
    [new Error('boom'), 'unknown'],
    [undefined, 'unknown'],
    [{ kind: 'network', name: 'ApiError' }, 'network'],
    [{ kind: 'server', status: 500 }, 'server'],
    [{ kind: 'bogus' }, 'unknown'],
  ])('classifies %p as %s', (err, kind) => {
    expect(classifyError(err)).toBe(kind);
  });

  it('never leaks raw backend text', () => {
    const msg = friendlyMessage({
      message: 'duplicate key value violates constraint "users_pkey"',
    });
    expect(msg).not.toMatch(/duplicate|constraint|pkey/);
  });
});
