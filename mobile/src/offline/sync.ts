import type { InvoiceWriteInput } from '@invoiceflow/shared';
import type { Estimate, Invoice } from '../models';
import { estimateAsInvoice } from '../utils/estimate';
import { friendlyMessage } from '../utils/errors';
import { serverHasContent } from './compare';
import { bumpAttempts, removeOp, setState } from './outbox';
import { kindOf, type DraftKind, type DraftOp, type OpState, type Problem } from './types';

/** The slice of the API client the queue needs (so tests can fake it). */
export interface SyncApi {
  createInvoice(input: InvoiceWriteInput & { id?: string }): Promise<Invoice>;
  updateInvoice(id: string, input: InvoiceWriteInput): Promise<Invoice>;
  deleteInvoice(id: string): Promise<void>;
  getInvoice(id: string): Promise<Invoice>;
  createEstimate(
    input: Omit<InvoiceWriteInput, 'dueDate'> & { expiryDate: string; id?: string },
  ): Promise<Estimate>;
  updateEstimate(
    id: string,
    input: Omit<InvoiceWriteInput, 'dueDate'> & { expiryDate: string },
  ): Promise<Estimate>;
  deleteEstimate(id: string): Promise<void>;
  getEstimate(id: string): Promise<Estimate>;
}

/**
 * One uniform way to talk to the server about an invoice or an estimate draft. The queue stores both
 * in the form's invoice shape; for an estimate `dueDate` is the expiry date and is renamed on the way out.
 */
interface Adapter {
  create(id: string, p: InvoiceWriteInput): Promise<unknown>;
  update(id: string, p: InvoiceWriteInput): Promise<unknown>;
  remove(id: string): Promise<void>;
  /** The server copy in invoice shape (so one comparison works for both). */
  get(id: string): Promise<Invoice>;
  lockedCodes: string[];
  notDraftCode: string;
  noun: 'invoice' | 'estimate';
}

const toEstimate = (p: InvoiceWriteInput) => {
  const { dueDate, ...rest } = p;
  return { ...rest, expiryDate: dueDate };
};

function adapterFor(api: SyncApi, kind: DraftKind): Adapter {
  if (kind === 'estimate') {
    return {
      create: (id, p) => api.createEstimate({ ...toEstimate(p), id }),
      update: (id, p) => api.updateEstimate(id, toEstimate(p)),
      remove: (id) => api.deleteEstimate(id),
      get: async (id) => {
        const e = await api.getEstimate(id);
        return { ...estimateAsInvoice(e), status: e.status as never, editable: e.editable };
      },
      lockedCodes: ['ESTIMATE_LOCKED'],
      notDraftCode: 'ESTIMATE_NOT_DRAFT',
      noun: 'estimate',
    };
  }
  return {
    create: (id, p) => api.createInvoice({ ...p, id }),
    update: (id, p) => api.updateInvoice(id, p),
    remove: (id) => api.deleteInvoice(id),
    get: (id) => api.getInvoice(id),
    lockedCodes: ['INVOICE_LOCKED'],
    notDraftCode: 'INVOICE_NOT_DRAFT',
    noun: 'invoice',
  };
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
      return 'That number is already used. Change the number or let it be assigned automatically.';
    case 'INVALID_CUSTOMER':
      return 'The customer was deleted or is no longer available. Choose another customer.';
    case 'INVALID_PRODUCT':
      return 'One of the products was deleted. Remove it from the items.';
    default:
      return friendlyMessage(e);
  }
}

const lockedFor = (noun: Adapter['noun']): Outcome => ({
  type: 'problem',
  state: 'conflict',
  problem: {
    code: 'locked',
    message:
      noun === 'estimate'
        ? 'This estimate was sent, answered or converted on another device, so it cannot be changed any more.'
        : 'This invoice was sent or paid on another device, so it cannot be changed any more.',
  },
});

async function create(a: Adapter, op: DraftOp, payload: InvoiceWriteInput): Promise<Outcome> {
  try {
    await a.create(op.invoiceId, payload);
    return { type: 'done' };
  } catch (e) {
    if (info(e).code !== 'ID_TAKEN') return transient(e) ?? rejected(e);
  }
  // The id exists: an earlier attempt reached the server and only the reply was lost. Bring the
  // existing draft up to date instead of creating a second one.
  let server: Invoice;
  try {
    server = await a.get(op.invoiceId);
  } catch (e) {
    return transient(e) ?? rejected(e);
  }
  if (serverHasContent(server, payload)) return { type: 'done' };
  if (server.status !== 'draft' || !server.editable) return lockedFor(a.noun);
  return update(a, { ...op, isNew: false, baseVersion: server.version }, payload);
}

async function update(a: Adapter, op: DraftOp, payload: InvoiceWriteInput): Promise<Outcome> {
  try {
    await a.update(op.invoiceId, {
      ...payload,
      ...(op.baseVersion !== null ? { version: op.baseVersion } : {}),
    });
    return { type: 'done' };
  } catch (e) {
    const { code, status } = info(e);
    if (code === 'VERSION_CONFLICT') {
      try {
        // Same content already on the server (the save worked, the reply was lost): not a conflict.
        if (serverHasContent(await a.get(op.invoiceId), payload)) return { type: 'done' };
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
    if (code && a.lockedCodes.includes(code)) return lockedFor(a.noun);
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

async function remove(a: Adapter, op: DraftOp): Promise<Outcome> {
  try {
    await a.remove(op.invoiceId);
    return { type: 'done' };
  } catch (e) {
    const { code, status } = info(e);
    if (status === 404 || code === 'NOT_FOUND') return { type: 'done' }; // already gone
    if (code === a.notDraftCode) {
      return {
        type: 'problem',
        state: 'conflict',
        problem: {
          code: 'locked',
          message: `This ${a.noun} was sent on another device, so it can no longer be deleted.`,
        },
      };
    }
    return transient(e) ?? rejected(e);
  }
}

export async function runOp(api: SyncApi, op: DraftOp): Promise<Outcome> {
  const a = adapterFor(api, kindOf(op));
  if (op.payload === null) return remove(a, op);
  return op.isNew ? create(a, op, op.payload) : update(a, op, op.payload);
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
  const a = adapterFor(api, kindOf(op));
  const server = await a.get(op.invoiceId);
  if (server.status !== 'draft' || !server.editable) {
    return { ok: false, problem: (lockedFor(a.noun) as { problem: Problem }).problem };
  }
  return { ok: true, version: server.version };
}
