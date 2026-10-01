import type { Payment } from '../models';

export const METHOD_LABELS: Record<NonNullable<Payment['method']>, string> = {
  card: 'Card',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  other: 'Other',
};

export const methodLabel = (m: Payment['method']) => (m ? METHOD_LABELS[m] : '—');

/** Short, readable payment reference (the Stripe intent id, else the first part of our id). */
export const paymentRef = (p: Pick<Payment, 'id' | 'stripePaymentIntentId'>) =>
  p.stripePaymentIntentId ?? p.id.slice(0, 8);
