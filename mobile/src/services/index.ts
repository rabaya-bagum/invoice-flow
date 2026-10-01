import { createApiClient, type ApiClient } from './api';
import { createAuthService, type AuthService } from './auth-service';
import * as biometrics from './biometrics';
import { unregisterPush } from './push';
import { getSupabase } from './supabase';

export interface Services {
  auth: AuthService;
  api: ApiClient;
  biometrics: typeof biometrics;
  /** Push registration cleanup used on sign-out (must run while still signed in). */
  push: { unregister(): Promise<void> };
}

let services: Services | null = null;

/** Wires the real Supabase client, API client and biometrics. Throws if env is missing. */
export function getServices(): Services {
  if (services) return services;
  const supabase = getSupabase();
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) throw new Error('Missing EXPO_PUBLIC_API_URL');
  const api = createApiClient({
    baseUrl,
    getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    refreshToken: async () =>
      (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
    onSessionExpired: () => void supabase.auth.signOut({ scope: 'local' }),
  });
  services = {
    auth: createAuthService(supabase),
    biometrics,
    api,
    push: { unregister: () => unregisterPush(api) },
  };
  return services;
}
