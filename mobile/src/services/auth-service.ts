import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { parseQuery } from '../utils/url';

export type AuthLinkResult =
  | { type: 'ignored' }
  | { type: 'verified' }
  | { type: 'recovery' }
  | { type: 'error'; error: unknown };

/** Thin wrapper over supabase.auth so screens and the store never touch the SDK directly. */
export function createAuthService(client: SupabaseClient) {
  const callbackUrl = () => Linking.createURL('auth/callback');
  const resetUrl = () => Linking.createURL('auth/reset');

  return {
    async getSession(): Promise<Session | null> {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session;
    },

    /** Subscribe to session changes. Callbacks must only set state (no supabase calls). */
    onChange(cb: (event: AuthChangeEvent, session: Session | null) => void): () => void {
      const { data } = client.auth.onAuthStateChange(cb);
      return () => data.subscription.unsubscribe();
    },

    async signIn(email: string, password: string): Promise<void> {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    /**
     * Returns whether the user must verify their email. For an already-registered address Supabase
     * returns success without a session, so the UI says "check your email" either way and never
     * reveals whether an account exists.
     */
    async signUp(input: { email: string; password: string; fullName: string }) {
      const { data, error } = await client.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { full_name: input.fullName }, emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
      return { needsVerification: !data.session };
    },

    async resendVerification(email: string): Promise<void> {
      const { error } = await client.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
    },

    async requestPasswordReset(email: string): Promise<void> {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: resetUrl() });
      if (error) throw error;
    },

    async updatePassword(password: string): Promise<void> {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },

    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    /** Handles invoiceflow://auth/callback?code=... (email verification) and auth/reset?code=... */
    async handleAuthUrl(url: string): Promise<AuthLinkResult> {
      const isReset = url.includes('auth/reset');
      if (!isReset && !url.includes('auth/callback')) return { type: 'ignored' };
      const params = parseQuery(url);
      const code = params.code;
      if (!code) {
        return {
          type: 'error',
          error: new Error(params.error_description ?? 'no code'),
        };
      }
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) return { type: 'error', error };
      return { type: isReset ? 'recovery' : 'verified' };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
