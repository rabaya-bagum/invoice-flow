import { MoneyError } from './errors';

/**
 * Minor-unit exponents (ISO 4217) for supported currencies.
 * Most are 2; zero- and three-decimal currencies are listed explicitly.
 * Note: Stripe treats some currencies specially (e.g. ISK, UGX as zero-decimal on the API
 * but two-decimal for payouts). Revisit when wiring Stripe in Phase 6.
 */
const EXPONENTS = {
  USD: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  NZD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  MXN: 2,
  BRL: 2,
  INR: 2,
  SGD: 2,
  HKD: 2,
  ZAR: 2,
  AED: 2,
  SAR: 2,
  PLN: 2,
  CZK: 2,
  PHP: 2,
  THB: 2,
  MYR: 2,
  ILS: 2,
  TRY: 2,
  NGN: 2,
  KES: 2,
  EGP: 2,
  BDT: 2,
  PKR: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  UGX: 0,
  XAF: 0,
  XOF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
} as const;

export type CurrencyCode = keyof typeof EXPONENTS;

export const SUPPORTED_CURRENCIES = Object.keys(EXPONENTS) as CurrencyCode[];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(EXPONENTS, code);
}

export function assertCurrency(code: string): asserts code is CurrencyCode {
  if (!isSupportedCurrency(code)) {
    throw new MoneyError('INVALID_CURRENCY', `Unsupported currency: ${code}`);
  }
}

export function getExponent(code: CurrencyCode): number {
  return EXPONENTS[code];
}
