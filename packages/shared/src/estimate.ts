import { z } from 'zod';
import { invoiceInputSchema } from './invoice-schemas';
import { listQuerySchema } from './schemas';
import { isValidDate } from './dates';

export const ESTIMATE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'rejected'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

/** "expired" is derived (sent/viewed past its expiry date), never stored. */
export type EstimateDisplayStatus = EstimateStatus | 'expired';

const TRANSITIONS: Record<EstimateStatus, readonly EstimateStatus[]> = {
  draft: ['sent'],
  sent: ['viewed', 'accepted', 'rejected'],
  viewed: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
};

export function canTransitionEstimate(from: EstimateStatus, to: EstimateStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** What the owner may request directly (viewing is tracked, not chosen). */
export const MANUAL_ESTIMATE_TRANSITIONS = ['sent', 'accepted', 'rejected'] as const;
export type ManualEstimateTransition = (typeof MANUAL_ESTIMATE_TRANSITIONS)[number];

/** Content can change until the customer has decided or it was turned into an invoice. */
export function isEstimateEditable(status: EstimateStatus, converted: boolean): boolean {
  return !converted && (status === 'draft' || status === 'sent' || status === 'viewed');
}

/** Only a live or accepted estimate can become an invoice, and only once. */
export function canConvertEstimate(status: EstimateStatus, converted: boolean): boolean {
  return !converted && status !== 'rejected';
}

export function estimateDisplayStatus(
  e: { status: EstimateStatus; expiryDate: string },
  today: string,
): EstimateDisplayStatus {
  return (e.status === 'sent' || e.status === 'viewed') && e.expiryDate < today
    ? 'expired'
    : e.status;
}

/** Same content rules as an invoice; "dueDate" becomes "expiryDate". */
export const estimateInputSchema = invoiceInputSchema
  .omit({ dueDate: true })
  .extend({ expiryDate: z.string().refine(isValidDate, 'Enter a valid date (YYYY-MM-DD)') });
export type EstimateWriteInput = z.infer<typeof estimateInputSchema>;

export const estimateTransitionSchema = z.object({ to: z.enum(MANUAL_ESTIMATE_TRANSITIONS) });

export const estimateListQuerySchema = listQuerySchema.extend({
  status: z.enum([...ESTIMATE_STATUSES, 'expired']).optional(),
  from: z.string().refine(isValidDate, 'Enter a valid date (YYYY-MM-DD)').optional(),
  to: z.string().refine(isValidDate, 'Enter a valid date (YYYY-MM-DD)').optional(),
  customerId: z.string().uuid().optional(),
});
export type EstimateListQuery = z.infer<typeof estimateListQuerySchema>;
