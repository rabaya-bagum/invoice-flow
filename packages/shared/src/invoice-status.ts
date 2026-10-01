export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'cancelled',
  'refunded',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** What users see: "overdue" is derived from due date and balance, never stored. */
export type DisplayStatus = InvoiceStatus | 'overdue';

/** Every legal status change, whoever triggers it (user, email tracking, payments). */
const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['viewed', 'partially_paid', 'paid', 'cancelled'],
  viewed: ['partially_paid', 'paid', 'cancelled'],
  partially_paid: ['paid', 'refunded'],
  paid: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Transitions a user may request directly. The rest are driven by sending, viewing and payments. */
export const MANUAL_TRANSITIONS = ['sent', 'cancelled'] as const;
export type ManualTransition = (typeof MANUAL_TRANSITIONS)[number];

/** Content can change only before any money has moved and while the invoice is still live. */
export function isEditable(status: InvoiceStatus, amountPaidMinor: number): boolean {
  return (status === 'draft' || status === 'sent' || status === 'viewed') && amountPaidMinor === 0;
}

const OVERDUE_ELIGIBLE: readonly InvoiceStatus[] = ['sent', 'viewed', 'partially_paid'];

export function isOverdue(
  inv: { status: InvoiceStatus; dueDate: string; balanceDueMinor: number },
  today: string,
): boolean {
  return OVERDUE_ELIGIBLE.includes(inv.status) && inv.balanceDueMinor > 0 && inv.dueDate < today;
}

export function displayStatus(
  inv: { status: InvoiceStatus; dueDate: string; balanceDueMinor: number },
  today: string,
): DisplayStatus {
  return isOverdue(inv, today) ? 'overdue' : inv.status;
}
