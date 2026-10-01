import { z } from 'zod';
import { CurrencyCode, getExponent } from './currency';
import { MoneyError } from './errors';
import { mulDivRound } from './rounding';

export const PAYMENT_STATUSES = ['pending', 'successful', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['card', 'apple_pay', 'google_pay', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Stripe quirks (https://docs.stripe.com/currencies): these are "special" currencies.
// ISK and UGX have no minor unit for us, but Stripe wants amounts as if they had two decimals.
const STRIPE_TWO_DECIMAL_FOR_ZERO: readonly string[] = ['ISK', 'UGX'];

/**
 * Our minor units -> the integer Stripe expects.
 *  - ISK/UGX: Stripe amounts are in hundredths, so multiply by 100.
 *  - Three-decimal currencies (BHD, JOD, KWD, OMR, TND): Stripe only accepts amounts divisible by 10.
 */
export function toStripeAmount(minor: number, currency: CurrencyCode): number {
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new MoneyError('INVALID_AMOUNT', 'Payment amount must be a positive integer');
  }
  if (STRIPE_TWO_DECIMAL_FOR_ZERO.includes(currency)) return minor * 100;
  if (getExponent(currency) === 3) {
    if (minor % 10 !== 0) {
      throw new MoneyError('INVALID_AMOUNT', `${currency} payments must be a multiple of 0.01`);
    }
  }
  return minor;
}

/** Stripe's integer back to our minor units (inverse of toStripeAmount). */
export function fromStripeAmount(stripeAmount: number, currency: CurrencyCode): number {
  if (STRIPE_TWO_DECIMAL_FOR_ZERO.includes(currency)) return Math.round(stripeAmount / 100);
  return stripeAmount;
}

/** Platform fee on a (Stripe-unit) amount, in basis points, rounded half up, always below the amount. */
export function platformFee(stripeAmount: number, feeBps: number): number {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 2000) {
    throw new MoneyError('INVALID_RATE', 'Platform fee must be 0-2000 basis points');
  }
  const fee = Number(mulDivRound(BigInt(stripeAmount), BigInt(feeBps), 10_000n));
  return Math.min(fee, Math.max(0, stripeAmount - 1));
}

/** Customer pays this much now; omit to pay the whole balance. */
export const paymentIntentInputSchema = z.object({
  amountMinor: z.number().int().min(1, 'Enter an amount').max(1_000_000_000_000).optional(),
});

export const refundInputSchema = z.object({
  /** Omit to refund the full remaining amount. */
  amountMinor: z.number().int().min(1, 'Enter an amount').max(1_000_000_000_000).optional(),
});

export const paymentListQuerySchema = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
