import type { InvoiceWriteInput } from '@invoiceflow/shared';
import type { DraftOp, DraftSummary, Problem } from './types';

const without = (ops: DraftOp[], id: string) => ops.filter((o) => o.invoiceId !== id);

export const findOp = (ops: DraftOp[], id: string) => ops.find((o) => o.invoiceId === id);

/**
 * Queue (or replace) the content for a draft. Repeated edits coalesce into one op that keeps the
 * FIRST base version, so a conflict check always compares against what the user originally saw.
 */
export function queueSave(
  ops: DraftOp[],
  input: {
    invoiceId: string;
    isNew: boolean;
    payload: InvoiceWriteInput;
    baseVersion: number | null;
    summary: DraftSummary;
  },
  now: string,
): DraftOp[] {
  const prev = findOp(ops, input.invoiceId);
  // Editing something already queued for deletion starts a fresh op.
  const base = prev && prev.payload !== null ? prev : undefined;
  const op: DraftOp = {
    invoiceId: input.invoiceId,
    isNew: base ? base.isNew : input.isNew,
    payload: input.payload,
    baseVersion: base ? base.baseVersion : input.baseVersion,
    summary: input.summary,
    queuedAt: base ? base.queuedAt : now,
    updatedAt: now,
    state: 'pending',
    attempts: 0,
  };
  return [...without(ops, input.invoiceId), op].sort((a, b) =>
    a.queuedAt.localeCompare(b.queuedAt),
  );
}

/**
 * Queue deleting a draft. Even for a draft created offline the delete is still sent (a 404 counts as
 * done): the create may have reached the server before the connection dropped.
 */
export function queueDelete(
  ops: DraftOp[],
  input: { invoiceId: string; isNew: boolean; summary: DraftSummary },
  now: string,
): DraftOp[] {
  const prev = findOp(ops, input.invoiceId);
  const op: DraftOp = {
    invoiceId: input.invoiceId,
    isNew: prev ? prev.isNew : input.isNew,
    payload: null,
    baseVersion: prev ? prev.baseVersion : null,
    summary: input.summary,
    queuedAt: prev ? prev.queuedAt : now,
    updatedAt: now,
    state: 'pending',
    attempts: 0,
  };
  return [...without(ops, input.invoiceId), op].sort((a, b) =>
    a.queuedAt.localeCompare(b.queuedAt),
  );
}

export const removeOp = without;

export function setState(
  ops: DraftOp[],
  id: string,
  state: DraftOp['state'],
  problem?: Problem,
): DraftOp[] {
  return ops.map((o) => (o.invoiceId === id ? { ...o, state, problem, attempts: o.attempts } : o));
}

export function bumpAttempts(ops: DraftOp[], id: string): DraftOp[] {
  return ops.map((o) => (o.invoiceId === id ? { ...o, attempts: o.attempts + 1 } : o));
}

/** Put a conflicted/failed op back in the queue (optionally against a newer server version). */
export function requeue(ops: DraftOp[], id: string, baseVersion?: number): DraftOp[] {
  return ops.map((o) =>
    o.invoiceId === id
      ? {
          ...o,
          state: 'pending',
          problem: undefined,
          attempts: 0,
          baseVersion: baseVersion ?? o.baseVersion,
        }
      : o,
  );
}

/**
 * Turn an op whose original can no longer be updated (sent, paid, deleted elsewhere) into a brand-new
 * draft with a new id. The typed number belonged to the old invoice, so the copy is auto-numbered.
 */
export function copyAsNew(ops: DraftOp[], id: string, newId: string, now: string): DraftOp[] {
  const op = findOp(ops, id);
  if (!op || !op.payload) return ops;
  const copy: DraftOp = {
    ...op,
    invoiceId: newId,
    isNew: true,
    baseVersion: null,
    payload: { ...op.payload, number: null, version: undefined },
    summary: { ...op.summary, number: null },
    queuedAt: now,
    updatedAt: now,
    state: 'pending',
    problem: undefined,
    attempts: 0,
  };
  return [...without(ops, id), copy].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export const pendingCount = (ops: DraftOp[]) => ops.filter((o) => o.state === 'pending').length;
export const attentionCount = (ops: DraftOp[]) => ops.filter((o) => o.state !== 'pending').length;
