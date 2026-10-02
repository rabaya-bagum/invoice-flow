import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { keys } from '../hooks/queries';
import { useAuth } from '../store/auth';
import { classifyError } from '../utils/errors';
import {
  attentionCount,
  copyAsNew,
  findOp,
  pendingCount,
  queueDelete,
  queueSave,
  removeOp,
  requeue,
  setState,
} from './outbox';
import { loadReference, saveReference, SNAPSHOT_LIMIT, type ReferenceSnapshot } from './reference';
import type { RandomBytes } from './crypto';
import { createSecureStoreVault, secureRandom, type KeyVault } from './vault';
import {
  createEncryptedStore,
  createFileStore,
  loadOutbox,
  outboxFile,
  referenceFile,
  saveOutbox,
  type TextStore,
} from './storage';
import { newInvoiceId } from './ids';
import { OfflineContext, type OfflineValue, type SaveDraftInput } from './context';
import { processOutbox, rebase, type SyncApi } from './sync';
import type { DraftKind, DraftOp, DraftSummary } from './types';

export { useOffline } from './context';

const RETRY_MS = 30_000;
const REFERENCE_MAX_AGE_MS = 10 * 60_000;

export function OfflineProvider({
  children,
  store: injected,
  vaultFor,
  random,
}: {
  children: ReactNode;
  /** Tests pass an in-memory store (plain text unless `vaultFor` is also given). */
  store?: TextStore;
  /** Where each user's encryption key lives. Defaults to the secure store. */
  vaultFor?: (userId: string) => KeyVault;
  random?: RandomBytes;
}) {
  const { api, status, session } = useAuth();
  const qc = useQueryClient();
  const files = useMemo(() => injected ?? createFileStore(), [injected]);
  const userId = status === 'signedIn' ? (session?.user.id ?? null) : null;
  // Everything written to the device is encrypted with a per-user key from the secure store.
  const encrypt = !injected || Boolean(vaultFor);
  const bundle = useMemo(() => {
    if (!userId) return null;
    const vault = encrypt ? (vaultFor?.(userId) ?? createSecureStoreVault(userId)) : null;
    return {
      files,
      vault,
      store: vault ? createEncryptedStore(files, vault, random ?? secureRandom) : files,
    };
  }, [userId, files, encrypt, vaultFor, random]);
  const store = bundle?.store ?? files;
  const lastBundle = useRef(bundle);

  const [ops, setOps] = useState<DraftOp[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;
  const [lastStop, setLastStop] = useState<OfflineValue['lastStop']>(null);
  const opsRef = useRef<DraftOp[]>([]);
  const userRef = useRef<string | null>(null);
  const snapshotRef = useRef<ReferenceSnapshot | null>(null);
  const running = useRef(false);
  const again = useRef(false);

  const commit = useCallback(
    async (next: DraftOp[]) => {
      opsRef.current = next;
      setOps(next);
      if (userRef.current) await saveOutbox(store, userRef.current, next);
    },
    [store],
  );

  // Load this user's queue and reference copy when they sign in; wipe both when they sign out.
  useEffect(() => {
    const previous = userRef.current;
    if (previous && previous !== userId) {
      // Delete the files, then the key: even a leftover copy of a file can no longer be read.
      const old = lastBundle.current;
      void (async () => {
        await (old?.files ?? files).remove(outboxFile(previous));
        await (old?.files ?? files).remove(referenceFile(previous));
        await old?.vault?.destroy();
      })();
      opsRef.current = [];
      snapshotRef.current = null;
      setOps([]);
    }
    userRef.current = userId;
    lastBundle.current = bundle;
    if (!userId) {
      setLoaded(true); // nothing to read when signed out
      return;
    }
    setLoaded(false);
    let cancelled = false;
    void (async () => {
      const [box, ref] = await Promise.all([
        loadOutbox(store, userId),
        loadReference(store, userId),
      ]);
      if (cancelled) return;
      // A fresher copy may already have been fetched while the old one was being read.
      if (ref && !snapshotRef.current) snapshotRef.current = ref;
      opsRef.current = box.ops;
      setOps(box.ops);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, store, bundle, files]);

  const syncNow = useCallback(async () => {
    if (!userRef.current) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setSyncing(true);
    try {
      do {
        again.current = false;
        if (!opsRef.current.some((o) => o.state === 'pending')) break;
        const startOps = opsRef.current;
        const result = await processOutbox(api as SyncApi, startOps);
        // The user may have saved again while we were uploading: never overwrite a newer edit.
        const started = new Map(startOps.map((o) => [o.invoiceId, o.updatedAt]));
        const after = new Map(result.ops.map((o) => [o.invoiceId, o]));
        const next: DraftOp[] = [];
        let editedDuringRun = false;
        for (const live of opsRef.current) {
          const was = started.get(live.invoiceId);
          if (was === undefined)
            next.push(live); // added during the run
          else if (live.updatedAt !== was) {
            editedDuringRun = true;
            // Edited during the run. If the old version just uploaded, this edit now follows it.
            next.push(
              result.synced.includes(live.invoiceId) && live.payload !== null
                ? { ...live, isNew: false, baseVersion: null, state: 'pending' }
                : live,
            );
          } else {
            const done = after.get(live.invoiceId);
            if (done) next.push(done); // still queued (pending/conflict/failed)
          }
        }
        await commit(next);
        if (editedDuringRun && !result.stopped) again.current = true;
        setLastStop(result.stopped);
        if (result.synced.length) {
          await Promise.all([
            qc.invalidateQueries({ queryKey: keys.invoices }),
            qc.invalidateQueries({ queryKey: keys.estimates }),
          ]);
        }
        if (result.stopped) break;
      } while (again.current);
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [api, commit, qc]);

  const refreshReference = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return;
    const age = Date.now() - new Date(snapshotRef.current?.savedAt ?? 0).getTime();
    if (age < REFERENCE_MAX_AGE_MS) return;
    try {
      const [business, taxRates, customers, products] = await Promise.all([
        api.getBusiness(),
        api.listTaxRates(),
        api.listCustomers({ limit: SNAPSHOT_LIMIT }),
        api.listProducts({ limit: SNAPSHOT_LIMIT, includeInactive: false }),
      ]);
      const snap: ReferenceSnapshot = {
        savedAt: new Date().toISOString(),
        business,
        taxRates: taxRates.items,
        customers: customers.items,
        products: products.items,
      };
      snapshotRef.current = snap;
      await saveReference(store, uid, snap);
    } catch {
      /* best effort: the copy is only for offline use */
    }
  }, [api, store]);

  // Try again when the app comes to the front, and every 30 s while something is waiting.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void syncNow();
        void refreshReference();
      }
    });
    return () => sub?.remove();
  }, [userId, syncNow, refreshReference]);

  const hasPending = ops.some((o) => o.state === 'pending');
  useEffect(() => {
    if (!userId || !hasPending) return;
    void syncNow(); // after loading, or once something new is waiting
    const t = setInterval(() => void syncNow(), RETRY_MS);
    return () => clearInterval(t);
  }, [userId, hasPending, syncNow]);

  useEffect(() => {
    if (userId) void refreshReference();
  }, [userId, refreshReference]);

  const saveDraft = useCallback(
    async (input: SaveDraftInput) => {
      await commit(queueSave(opsRef.current, input, new Date().toISOString()));
    },
    [commit],
  );

  const deleteDraft = useCallback(
    async (input: {
      invoiceId: string;
      kind?: DraftKind;
      isNew: boolean;
      summary: DraftSummary;
    }) => {
      await commit(queueDelete(opsRef.current, input, new Date().toISOString()));
    },
    [commit],
  );

  const discard = useCallback(
    async (id: string) => {
      await commit(removeOp(opsRef.current, id));
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.invoices }),
        qc.invalidateQueries({ queryKey: keys.estimates }),
      ]);
    },
    [commit, qc],
  );

  const keepMine = useCallback(
    async (id: string): Promise<string | null> => {
      const op = findOp(opsRef.current, id);
      if (!op) return null;
      try {
        const r = await rebase(api as SyncApi, op);
        if (!r.ok) {
          await commit(setState(opsRef.current, id, 'conflict', r.problem));
          return r.problem.message;
        }
        await commit(requeue(opsRef.current, id, r.version));
        void syncNow();
        return null;
      } catch (e) {
        return classifyError(e) === 'network'
          ? 'No connection right now. Try again when you are online.'
          : 'Could not check the server copy. Try again.';
      }
    },
    [api, commit, syncNow],
  );

  const saveAsCopy = useCallback(
    async (id: string) => {
      await commit(copyAsNew(opsRef.current, id, newInvoiceId(), new Date().toISOString()));
      void syncNow();
    },
    [commit, syncNow],
  );

  /** The saved lists. Reads the file if a screen asks before the first load has finished. */
  const getSnapshot = useCallback(async () => {
    if (snapshotRef.current) return snapshotRef.current;
    const uid = userIdRef.current;
    if (!uid) return null;
    const ref = await loadReference(store, uid);
    if (ref && !snapshotRef.current) snapshotRef.current = ref;
    return snapshotRef.current;
  }, [store]);

  const value = useMemo<OfflineValue>(
    () => ({
      available: true,
      ops,
      pending: pendingCount(ops),
      attention: attentionCount(ops),
      syncing,
      lastStop,
      getOp: (id) => findOp(ops, id),
      saveDraft,
      deleteDraft,
      syncNow,
      keepMine,
      saveAsCopy,
      discard,
      loaded,
      getSnapshot,
    }),
    [
      ops,
      loaded,
      syncing,
      lastStop,
      saveDraft,
      deleteDraft,
      syncNow,
      keepMine,
      saveAsCopy,
      discard,
      getSnapshot,
    ],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
