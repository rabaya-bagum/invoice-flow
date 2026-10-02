import type { InvoiceWriteInput } from '@invoiceflow/shared';
import type { Invoice } from '../models';
import { friendlyMessage } from '../utils/errors';
import { serverHasContent } from './compare';
import { bumpAttempts, removeOp, setState } from './outbox';
import type { DraftOp, OpState, Problem } from './types';

/** The slice of the API client the queue needs (so tests can fake it). */
export interface SyncApi {
  createInvoice(input: InvoiceWriteInput & { id?: string }): Promise<Invoice>;
  updateInvoice(id: string, input: InvoiceWriteInput): Promise<Invoice>;
  deleteInvoice(id: string): Promise<void>;
  getInvoice(id: string): Promise<Invoice>;
}

type Outcome =
  | { type: 'done' }
  | { type: 'retry'; why: 'offline' | 'busy' }
  | { type: 'auth' }
  | { type: 'problem'; state: Exclude<OpState, 'pending'>; problem: Problem };

interface ErrInfo {
  kind?: string;
  status?: number;
  code?: string;
}
const info = (e: unknown): ErrInfo => (e ?? {}) as ErrInfo;

const RETRY_CODES = new Set(['PAYMENT_IN_PROGRESS', 'NUMBERING_BUSY']);

/** Anything that says "try again later" rather than "this content is wrong". */
function transient(e: unknown): Outcome | null {
  const { kind, code } = info(e);
  if (kind === 'session_expired') return { type: 'auth' };
  if (kind === 'network') return { type: 'retry', why: 'offline' };
  if (kind === 'server' || kind === 'rate_limited' || (code && RETRY_CODES.has(code)))
    return { type: 'retry', why: 'busy' };
  return null;
}

const rejected = (e: unknown): Outcome => ({
  type: 'problem',
  state: 'failed',
  problem: { code: 'rejected', message: reason(e) },
});

function reason(e: unknown): string {
  switch (info(e).code) {
    case 'NUMBER_EXISTS':
      return 'That invoice number is already used. Change the number or let it be assigned automatically.';
    case 'INVALID_CUSTOMER':
      return 'The customer was deleted or is no longer available. Choose another customer.';
    case 'INVALID_PRODUCT':
      return 'One of the products was deleted. Remove it from the items.';
    default:
      return friendlyMessage(e);
  }
}

const locked: Outcome = {
  type: 'problem',
  state: 'conflict',
  problem: {
    code: 'locked',
    message: 'This invoice was sent or paid on another device, so it cannot be changed any more.',
  },
};

async function create(api: SyncApi, op: DraftOp, payload: InvoiceWriteInput): Promise<Outcome> {
  try {
    await api.createInvoice({ ...payload, id: op.invoiceId });
    return { type: 'done' };
  } catch (e) {
    if (info(e).code !== 'ID_TAKEN') return transient(e) ?? rejected(e);
  }
  // The id exists: an earlier attempt reached the server and only the reply was lost. Bring the
  // existing draft up to date instead of creating a second invoice.
  let server: Invoice;
  try {
    server = await api.getInvoice(op.invoiceId);
  } catch (e) {
    return transient(e) ?? rejected(e);
  }
  if (serverHasContent(server, payload)) return { type: 'done' };
  if (server.status !== 'draft' || !server.editable) return locked;
  return update(api, { ...op, isNew: false, baseVersion: server.version }, payload);
}

async function update(api: SyncApi, op: DraftOp, payload: InvoiceWriteInput): Promise<Outcome> {
  try {
    await api.updateInvoice(op.invoiceId, {
      ...payload,
      ...(op.baseVersion !== null ? { version: op.baseVersion } : {}),
    });
    return { type: 'done' };
  } catch (e) {
    const { code, status } = info(e);
    if (code === 'VERSION_CONFLICT') {
      try {
        // Same content already on the server (the save worked, the reply was lost): not a conflict.
        if (serverHasContent(await api.getInvoice(op.invoiceId), payload)) return { type: 'done' };
      } catch (inner) {
        return transient(inner) ?? { type: 'retry', why: 'offline' };
      }
      return {
        type: 'problem',
        state: 'conflict',
        problem: {
          code: 'version_conflict',
          message: 'This draft was changed on another device while you were offline.',
        },
      };
    }
    if (code === 'INVOICE_LOCKED') return locked;
    if (status === 404 || code === 'NOT_FOUND') {
      return {
        type: 'problem',
        state: 'conflict',
        problem: { code: 'deleted', message: 'This draft was deleted on another device.' },
      };
    }
    return transient(e) ?? rejected(e);
  }
}

async function remove(api: SyncApi, op: DraftOp): Promise<Outcome> {
  try {
    await api.deleteInvoice(op.invoiceId);
    return { type: 'done' };
  } catch (e) {
    const { code, status } = info(e);
    if (status === 404 || code === 'NOT_FOUND') return { type: 'done' }; // already gone
    if (code === 'INVOICE_NOT_DRAFT') {
      return {
        type: 'problem',
        state: 'conflict',
        problem: {
          code: 'locked',
          message: 'This invoice was sent on another device, so it can no longer be deleted.',
        },
      };
    }
    return transient(e) ?? rejected(e);
  }
}

export async function runOp(api: SyncApi, op: DraftOp): Promise<Outcome> {
  if (op.payload === null) return remove(api, op);
  return op.isNew ? create(api, op, op.payload) : update(api, op, op.payload);
}

export interface SyncResult {
  ops: DraftOp[];
  /** Invoice ids that were uploaded or deleted (their cached copies are now stale). */
  synced: string[];
  /** Why the run stopped early, if it did. */
  stopped: 'offline' | 'busy' | 'auth' | null;
}

/**
 * Uploads pending ops oldest first. Stops at the first connection/server trouble (the rest would fail
 * the same way) but carries on past an op that has a problem of its own.
 */
export async function processOutbox(api: SyncApi, input: DraftOp[]): Promise<SyncResult> {
  let ops = input;
  const synced: string[] = [];
  for (const op of input) {
    if (op.state !== 'pending') continue;
    const out = await runOp(api, op);
    if (out.type === 'done') {
      ops = removeOp(ops, op.invoiceId);
      synced.push(op.invoiceId);
    } else if (out.type === 'problem') {
      ops = setState(ops, op.invoiceId, out.state, out.problem);
    } else {
      ops = bumpAttempts(ops, op.invoiceId);
      return { ops, synced, stopped: out.type === 'auth' ? 'auth' : out.why };
    }
  }
  return { ops, synced, stopped: null };
}

/**
 * "Keep my version" after a version conflict: re-base the edit on the server's current version, but
 * only while that draft can still be edited.
 */
export async function rebase(
  api: SyncApi,
  op: DraftOp,
): Promise<{ ok: true; version: number } | { ok: false; problem: Problem }> {
  const server = await api.getInvoice(op.invoiceId);
  if (server.status !== 'draft' || !server.editable) {
    return { ok: false, problem: (locked as { problem: Problem }).problem };
  }
  return { ok: true, version: server.version };
}
