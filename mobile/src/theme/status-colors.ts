export type Scheme = 'light' | 'dark';

/**
 * Badge text colours. Each is readable (>= 4.5:1) on its own 10% tint over BOTH the page background and
 * the card surface, in light and dark mode; `__tests__/theme-contrast.test.ts` keeps it that way.
 */
export const STATUS_COLORS = {
  draft: { light: '#59687C', dark: '#8593A7' },
  sent: { light: '#1759EA', dark: '#6692F1' },
  viewed: { light: '#7935ED', dark: '#A87BF3' },
  partially_paid: { light: '#A54C08', dark: '#E96C0C' },
  paid: { light: '#137337', dark: '#1BA750' },
  overdue: { light: '#C42020', dark: '#E76C6C' },
  cancelled: { light: '#5F6672', dark: '#8D94A0' },
  refunded: { light: '#0D6D87', dark: '#13A1C8' },
  accepted: { light: '#137337', dark: '#1BA750' },
  rejected: { light: '#B91C1C', dark: '#E86767' },
  expired: { light: '#9A3412', dark: '#E96C43' },
} as const satisfies Record<string, Record<Scheme, string>>;

export type StatusKey = keyof typeof STATUS_COLORS;

export const statusColor = (key: string, scheme: Scheme): string =>
  (STATUS_COLORS[key as StatusKey] ?? STATUS_COLORS.draft)[scheme];
