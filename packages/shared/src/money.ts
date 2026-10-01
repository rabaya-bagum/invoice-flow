import { CurrencyCode, getExponent } from './currency';
import { MoneyError } from './errors';

/** Parse "1250.5" / "1,250.50" style user input to minor units without floats. */
export function parseMoney(input: string, currency: CurrencyCode): number {
  const exp = getExponent(currency);
  const clean = input.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!m) throw new MoneyError('INVALID_AMOUNT', `Invalid amount: "${input}"`);
  const whole = m[1] as string;
  const frac = m[2] ?? '';
  if (frac.length > exp) {
    throw new MoneyError('INVALID_AMOUNT', `${currency} allows at most ${exp} decimal places`);
  }
  const minor = BigInt(whole + frac.padEnd(exp, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError('INVALID_AMOUNT', 'Amount too large');
  }
  return Number(minor);
}

/** Minor units -> plain decimal string, e.g. 6778 USD -> "67.78". Exact. */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  if (!Number.isSafeInteger(minor)) throw new MoneyError('INVALID_AMOUNT', 'Not an integer');
  const exp = getExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp);
  const frac = digits.slice(digits.length - exp);
  return `${neg ? '-' : ''}${whole}${exp ? '.' + frac : ''}`;
}

/** Locale-aware display string. Display only: never parse this back. */
export function formatMoney(minor: number, currency: CurrencyCode, locale = 'en-US'): string {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  // Pass the exact decimal string (Intl.NumberFormat v3) so no float rounding happens.
  return (fmt.format as (v: unknown) => string)(minorToDecimalString(minor, currency));
}

/** Quantities use three decimal places, stored as integer thousandths ("1.5" -> 1500). */
export function parseQuantity(input: string): number {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) throw new MoneyError('INVALID_QUANTITY', `Invalid quantity: "${input}"`);
  const milli = Number(BigInt((m[1] as string) + (m[2] ?? '').padEnd(3, '0')));
  if (!Number.isSafeInteger(milli)) throw new MoneyError('INVALID_QUANTITY', 'Quantity too large');
  return milli;
}

export function formatQuantity(milli: number): string {
  const s = String(milli).padStart(4, '0');
  const out = `${s.slice(0, -3)}.${s.slice(-3)}`.replace(/\.?0+$/, '');
  return out;
}

/** "13.5" or "5" (percent) -> basis points (1350 / 500). Max two decimals, 0-100. */
export function parsePercent(input: string): number {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ''));
  if (!m) throw new MoneyError('INVALID_RATE', `Invalid percentage: "${input}"`);
  const bps = Number((m[1] as string) + (m[2] ?? '').padEnd(2, '0'));
  if (bps > 10_000) throw new MoneyError('INVALID_RATE', 'Percentage cannot exceed 100');
  return bps;
}

/** 1350 -> "13.5", 500 -> "5". */
export function formatPercent(bps: number): string {
  const s = String(bps).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`.replace(/\.?0+$/, '');
}
