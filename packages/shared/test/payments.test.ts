import {
  fromStripeAmount,
  MoneyError,
  paymentIntentInputSchema,
  paymentListQuerySchema,
  platformFee,
  refundInputSchema,
  SUPPORTED_CURRENCIES,
  toStripeAmount,
} from '../src';

describe('toStripeAmount / fromStripeAmount', () => {
  it('passes normal currencies through', () => {
    expect(toStripeAmount(12_550, 'USD')).toBe(12_550);
    expect(toStripeAmount(1_000, 'JPY')).toBe(1_000); // JPY is zero-decimal for Stripe too
  });
  it('scales ISK and UGX by 100 (Stripe treats them as two-decimal)', () => {
    expect(toStripeAmount(5_000, 'ISK')).toBe(500_000);
    expect(toStripeAmount(100, 'UGX')).toBe(10_000);
    expect(fromStripeAmount(500_000, 'ISK')).toBe(5_000);
  });
  it('requires three-decimal currencies to be multiples of 10', () => {
    expect(toStripeAmount(1_230, 'KWD')).toBe(1_230);
    expect(() => toStripeAmount(1_234, 'KWD')).toThrow(MoneyError);
    expect(() => toStripeAmount(5, 'BHD')).toThrow(MoneyError);
  });
  it('rejects non-positive or fractional amounts', () => {
    for (const bad of [0, -1, 1.5, Number.NaN])
      expect(() => toStripeAmount(bad, 'USD')).toThrow(MoneyError);
  });
  it('round-trips for every supported currency', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(fromStripeAmount(toStripeAmount(1_230, c), c)).toBe(1_230);
    }
  });
});

describe('platformFee', () => {
  it('computes basis points rounded half up', () => {
    expect(platformFee(10_000, 250)).toBe(250); // 2.5% of $100.00
    expect(platformFee(999, 250)).toBe(25); // 24.975 -> 25
    expect(platformFee(10_000, 0)).toBe(0);
  });
  it('never reaches the full amount and validates the rate', () => {
    expect(platformFee(1, 2000)).toBe(0);
    expect(platformFee(5, 2000)).toBe(1);
    expect(() => platformFee(100, 2001)).toThrow(MoneyError);
    expect(() => platformFee(100, -1)).toThrow(MoneyError);
  });
});

describe('payment schemas', () => {
  it('accepts an optional positive integer amount', () => {
    expect(paymentIntentInputSchema.parse({})).toEqual({});
    expect(paymentIntentInputSchema.parse({ amountMinor: 40_000 })).toEqual({
      amountMinor: 40_000,
    });
    for (const bad of [0, -5, 1.5, '100'])
      expect(paymentIntentInputSchema.safeParse({ amountMinor: bad }).success).toBe(false);
    expect(refundInputSchema.safeParse({ amountMinor: -1 }).success).toBe(false);
  });
  it('parses list filters', () => {
    expect(paymentListQuerySchema.parse({ status: 'successful' })).toMatchObject({
      status: 'successful',
      limit: 25,
    });
    expect(paymentListQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false);
  });
});
