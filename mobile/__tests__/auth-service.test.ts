import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthService } from '../src/services/auth-service';

function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (name: string, result: unknown) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return result;
    };
  const auth = {
    exchangeCodeForSession: rec('exchange', { error: null }),
    signUp: rec('signUp', { data: { session: null }, error: null }),
    resetPasswordForEmail: rec('reset', { error: null }),
    resend: rec('resend', { error: null }),
    ...overrides,
  };
  return { client: { auth } as unknown as SupabaseClient, calls };
}

describe('auth service', () => {
  it('exchanges the code from a verification link', async () => {
    const { client, calls } = fakeClient();
    const r = await createAuthService(client).handleAuthUrl('invoiceflow://auth/callback?code=abc');
    expect(r).toEqual({ type: 'verified' });
    expect(calls.exchange).toEqual([['abc']]);
  });

  it('reports recovery for a reset link', async () => {
    const { client } = fakeClient();
    const r = await createAuthService(client).handleAuthUrl('invoiceflow://auth/reset?code=abc');
    expect(r).toEqual({ type: 'recovery' });
  });

  it('errors on a link with no code, and surfaces exchange failures', async () => {
    const { client } = fakeClient();
    expect(
      (await createAuthService(client).handleAuthUrl('invoiceflow://auth/callback')).type,
    ).toBe('error');
    const failing = fakeClient({
      exchangeCodeForSession: async () => ({ error: new Error('expired') }),
    });
    expect(
      (await createAuthService(failing.client).handleAuthUrl('invoiceflow://auth/reset?code=x'))
        .type,
    ).toBe('error');
  });

  it('ignores unrelated links', async () => {
    const { client, calls } = fakeClient();
    expect(await createAuthService(client).handleAuthUrl('invoiceflow://invoices/123')).toEqual({
      type: 'ignored',
    });
    expect(calls.exchange).toBeUndefined();
  });

  it('sign-up with email confirmation reports needsVerification and sends metadata', async () => {
    const { client, calls } = fakeClient();
    const r = await createAuthService(client).signUp({
      email: 'a@b.co',
      password: 'pw',
      fullName: 'Ann',
    });
    expect(r).toEqual({ needsVerification: true });
    expect(JSON.stringify(calls.signUp)).toContain('full_name');
  });

  it('throws Supabase errors so the UI can map them', async () => {
    const err = { code: 'invalid_credentials' };
    const { client } = fakeClient({ signInWithPassword: async () => ({ error: err }) });
    await expect(createAuthService(client).signIn('a@b.co', 'x')).rejects.toBe(err);
  });
});
