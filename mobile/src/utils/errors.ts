export type ErrorKind =
  | 'network'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'rate_limited'
  | 'weak_password'
  | 'session_expired'
  | 'server'
  | 'unknown';

interface ErrorLike {
  kind?: string;
  code?: string;
  status?: number;
  message?: string;
  name?: string;
}

/** Map any thrown value (Supabase, fetch, our API) to a stable kind. */
export function classifyError(err: unknown): ErrorKind {
  const e = (err ?? {}) as ErrorLike;
  // Errors from our own API client already carry a classified kind.
  if (e.kind && e.kind in MESSAGES) return e.kind as ErrorKind;
  const msg = (e.message ?? '').toLowerCase();
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.name === 'AbortError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('timed out')
  ) {
    return 'network';
  }
  switch (e.code) {
    case 'invalid_credentials':
      return 'invalid_credentials';
    case 'email_not_confirmed':
      return 'email_not_verified';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate_limited';
    case 'weak_password':
      return 'weak_password';
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return 'session_expired';
  }
  if (e.status === 401) return 'session_expired';
  if (e.status === 429) return 'rate_limited';
  if (typeof e.status === 'number' && e.status >= 500) return 'server';
  return 'unknown';
}

const MESSAGES: Record<ErrorKind, string> = {
  network: 'No internet connection. Check your network and try again.',
  invalid_credentials: 'Incorrect email or password.',
  email_not_verified: 'Please verify your email address first. Check your inbox for the link.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  weak_password:
    'That password is too weak. Use at least 10 characters with a letter and a number.',
  session_expired: 'Your session has expired. Please sign in again.',
  server: 'Our servers are having trouble. Please try again shortly.',
  unknown: 'Something went wrong. Please try again.',
};

/** Always a user-safe string. Raw backend messages are never shown. */
export function friendlyMessage(err: unknown): string {
  return MESSAGES[classifyError(err)];
}
