import type { InvoiceWriteInput } from '@invoiceflow/shared';
import { createContext, useContext } from 'react';
import type { ReferenceSnapshot } from './reference';
import type { DraftKind, DraftOp, DraftSummary } from './types';

export interface SaveDraftInput {
  invoiceId: string;
  kind?: DraftKind;
  isNew: boolean;
  payload: InvoiceWriteInput;
  baseVersion: number | null;
  summary: DraftSummary;
}

export interface OfflineValue {
  /** False when no provider is mounted (the app then behaves exactly as before: online only). */
  available: boolean;
  ops: DraftOp[];
  pending: number;
  attention: number;
  syncing: boolean;
  /** Why the last upload attempt stopped, if it did. */
  lastStop: 'offline' | 'busy' | 'auth' | null;
  getOp(invoiceId: string): DraftOp | undefined;
  saveDraft(input: SaveDraftInput): Promise<void>;
  deleteDraft(input: {
    invoiceId: string;
    kind?: DraftKind;
    isNew: boolean;
    summary: DraftSummary;
  }): Promise<void>;
  syncNow(): Promise<void>;
  /** Re-base my edit on the server's current version and upload it. */
  keepMine(invoiceId: string): Promise<string | null>;
  /** Save my edit as a new draft instead (the original was sent, paid or deleted). */
  saveAsCopy(invoiceId: string): Promise<void>;
  /** Throw my queued change away and use whatever the server has. */
  discard(invoiceId: string): Promise<void>;
  /** True once the saved queue has been read (before that, a draft may exist that we cannot see yet). */
  loaded: boolean;
  /** Latest copy of the lists the form needs; works with no connection. */
  getSnapshot(): Promise<ReferenceSnapshot | null>;
}

export const NOOP: OfflineValue = {
  available: false,
  ops: [],
  pending: 0,
  attention: 0,
  syncing: false,
  lastStop: null,
  getOp: () => undefined,
  saveDraft: async () => undefined,
  deleteDraft: async () => undefined,
  syncNow: async () => undefined,
  keepMine: async () => null,
  saveAsCopy: async () => undefined,
  discard: async () => undefined,
  loaded: true,
  getSnapshot: async () => null,
};

export const OfflineContext = createContext<OfflineValue>(NOOP);
export const useOffline = () => useContext(OfflineContext);
