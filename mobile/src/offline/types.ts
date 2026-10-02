import type { InvoiceWriteInput } from '@invoiceflow/shared';

/** What the list shows for a queued draft (the payload alone has only ids). */
export interface DraftSummary {
  customerName: string;
  currency: string;
  totalMinor: number;
  /** The number the user typed, or null while it is auto-assigned by the server. */
  number: string | null;
}

/**
 * pending  - waiting to upload (offline, or not tried yet)
 * conflict - the server copy changed or locked underneath us; the user must choose
 * failed   - the server refused the content (e.g. number taken); the user must edit or discard
 */
export type OpState = 'pending' | 'conflict' | 'failed';

export type ProblemCode = 'version_conflict' | 'locked' | 'deleted' | 'rejected';

export interface Problem {
  code: ProblemCode;
  message: string;
}

/** One queued change to one invoice draft. There is at most one per invoice (edits coalesce). */
export interface DraftOp {
  invoiceId: string;
  /** Not known to exist on the server yet (created offline). */
  isNew: boolean;
  /** The full content to save; null means "delete this draft". */
  payload: InvoiceWriteInput | null;
  /** The server version this edit started from (the first edit's base wins when edits coalesce). */
  baseVersion: number | null;
  summary: DraftSummary;
  queuedAt: string;
  updatedAt: string;
  state: OpState;
  problem?: Problem;
  attempts: number;
}

export interface OutboxState {
  ops: DraftOp[];
}

export const EMPTY_OUTBOX: OutboxState = { ops: [] };
