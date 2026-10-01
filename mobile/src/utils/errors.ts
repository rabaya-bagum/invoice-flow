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

/** Messages for specific API error codes (our own API's codes, safe to translate to plain language). */
const CODE_MESSAGES: Record<string, string> = {
  NUMBER_EXISTS: 'That invoice number is already used. Leave it blank to number automatically.',
  INVALID_CUSTOMER: 'Choose a valid customer.',
  INVALID_PRODUCT: 'One of the selected products no longer exists. Remove it and try again.',
  INVALID_INVOICE: 'Some amounts are not valid. Check the discount, prices and quantities.',
  VERSION_CONFLICT:
    'This invoice was changed elsewhere. Go back and reopen it to see the latest version.',
  INVOICE_LOCKED: 'This invoice can no longer be edited.',
  INVOICE_NOT_DRAFT: 'Only drafts can be deleted. Cancel the invoice instead.',
  INVALID_TRANSITION: 'That change is not allowed for this invoice.',
  PDF_FAILED: 'The PDF could not be generated. Please try again.',
  EMAIL_FAILED: 'The invoice could not be sent. Check the email address and try again.',
  NO_RECIPIENT: 'Add an email address for this customer, or enter one below.',
  INVOICE_NOT_SENDABLE: 'This invoice can no longer be sent.',
  IMAGE_TOO_LARGE: 'That image is too large. Choose one under 1 MB.',
  IMAGE_TYPE: 'Use a PNG or JPEG image.',
  PAYMENTS_UNAVAILABLE: 'Online payments are not available right now.',
  PAYMENTS_NOT_ENABLED: 'Set up online payments first (More → Online payments).',
  PAYMENT_PROVIDER_ERROR: 'The payment provider could not be reached. Please try again.',
  PAYMENT_IN_PROGRESS: 'A payment is in progress for this invoice. Try again in a moment.',
  NOT_REFUNDABLE: 'Only successful payments can be refunded.',
  AMOUNT_TOO_HIGH: 'That amount is higher than allowed.',
  SKU_EXISTS: 'Another product already uses that SKU.',
};

/** Always a user-safe string. Raw backend messages are never shown. */
export function friendlyMessage(err: unknown): string {
  const code = (err as ErrorLike | undefined)?.code;
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  return MESSAGES[classifyError(err)];
}
