/** Calendar dates are plain "YYYY-MM-DD" strings everywhere (no timezone attached). */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

export function addDays(date: string, days: number): string {
  const dt = parse(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt);
}

/** Today's calendar date in an IANA timezone (falls back to UTC for an unknown zone). */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return fmt(now);
  }
}

export type DatePreset = 'today' | 'this_week' | 'this_month';

/** Inclusive date range for list filters. Weeks start on Monday. */
export function dateRangeFor(preset: DatePreset, today: string): { from: string; to: string } {
  if (preset === 'today') return { from: today, to: today };
  const dt = parse(today);
  if (preset === 'this_week') {
    const offset = (dt.getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(today, -offset);
    return { from, to: addDays(from, 6) };
  }
  const from = fmt(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)));
  const to = fmt(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
  return { from, to };
}

/** "2026-10-15" -> "October 15, 2026". Calendar dates have no timezone, so format in UTC. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
