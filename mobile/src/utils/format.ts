import { formatMoney, isSupportedCurrency } from '@invoiceflow/shared';

/** Currency formatting that never throws on an unexpected code. */
export function money(minor: number, currency: string): string {
  return isSupportedCurrency(currency) ? formatMoney(minor, currency) : `${minor} ${currency}`;
}

/** "2026-10-15" -> "Oct 15, 2026" (no timezone conversion: it is a calendar date). */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
