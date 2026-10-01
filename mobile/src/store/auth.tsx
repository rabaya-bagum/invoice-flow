import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { ApiClient } from '../services/api';
import type { Services } from '../services';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'recovery';

/** Re-lock after the app has been in the background this long. */
export const LOCK_AFTER_MS = 30_000;

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  locked: boolean;
  biometricEnabled: boolean;
  /** One-shot message from an email link (e.g. "Email verified"), shown on the login screen. */
  notice: string | null;
  api: ApiClient;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<{ needsVerification: boolean }>;
  resendVerification(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  unlock(): Promise<boolean>;
  setBiometricEnabled(enabled: boolean): Promise<boolean>;
  isBiometricAvailable(): Promise<boolean>;
  dismissNotice(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const enabledRef = useRef(false);
  enabledRef.current = biometricEnabled;

  // Initial session + biometric preference. Cold start with the lock enabled starts locked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, enabled] = await Promise.all([
          services.auth.getSession(),
          services.biometrics.getBiometricEnabled(),
        ]);
        if (cancelled) return;
        setSession(s);
        setBiometricEnabledState(enabled);
        setLocked(Boolean(s) && enabled);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [services]);

  // Session changes. Only set state here: calling supabase methods inside this callback can deadlock.
  useEffect(() => {
    return services.auth.onChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        setRecovery(false);
        setLocked(false);
      }
    });
  }, [services]);

  // Re-lock after time in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (enabledRef.current && away >= LOCK_AFTER_MS) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  // Email-verification and password-reset deep links.
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const result = await services.auth.handleAuthUrl(url);
      if (result.type === 'recovery') setRecovery(true);
      else if (result.type === 'verified') setNotice('Email verified. You can now sign in.');
      else if (result.type === 'error') {
        setNotice('That link is invalid or has expired. Please request a new one.');
      }
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => void handle(e.url));
    return () => sub.remove();
  }, [services]);

  const signOut = useCallback(async () => {
    // Unregister this device first: the API call needs the session that signOut is about to end.
    await services.push.unregister().catch(() => undefined);
    try {
      await services.auth.signOut();
    } finally {
      await services.biometrics.setBiometricEnabled(false);
      setBiometricEnabledState(false);
      setLocked(false);
      setRecovery(false);
    }
  }, [services]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: loading
        ? 'loading'
        : recovery && session
          ? 'recovery'
          : session
            ? 'signedIn'
            : 'signedOut',
      session,
      locked,
      biometricEnabled,
      notice,
      api: services.api,
      signIn: (email, password) => services.auth.signIn(email, password),
      signUp: (input) => services.auth.signUp(input),
      resendVerification: (email) => services.auth.resendVerification(email),
      requestPasswordReset: (email) => services.auth.requestPasswordReset(email),
      updatePassword: async (password) => {
        await services.auth.updatePassword(password);
        setRecovery(false);
      },
      signOut,
      unlock: async () => {
        const ok = await services.biometrics.authenticate();
        if (ok) setLocked(false);
        return ok;
      },
      setBiometricEnabled: async (enabled) => {
        if (enabled) {
          if (!(await services.biometrics.isBiometricAvailable())) return false;
          // Require a successful scan before turning the lock on.
          if (!(await services.biometrics.authenticate('Enable biometric unlock'))) return false;
        }
        await services.biometrics.setBiometricEnabled(enabled);
        setBiometricEnabledState(enabled);
        return true;
      },
      isBiometricAvailable: () => services.biometrics.isBiometricAvailable(),
      dismissNotice: () => setNotice(null),
    }),
    [loading, recovery, session, locked, biometricEnabled, notice, services, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
