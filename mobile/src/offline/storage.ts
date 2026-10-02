import { File, Paths } from 'expo-file-system';
import { EMPTY_OUTBOX, type DraftOp, type OutboxState } from './types';

/** A tiny named-text store, so the queue logic does not care where bytes live (and tests need no disk). */
export interface TextStore {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export function createFileStore(): TextStore {
  const file = (name: string) => new File(Paths.document, name);
  return {
    async read(name) {
      const f = file(name);
      return f.exists ? await f.text() : null;
    },
    async write(name, text) {
      const f = file(name);
      f.create({ overwrite: true });
      f.write(text);
    },
    async remove(name) {
      const f = file(name);
      if (f.exists) f.delete();
    },
  };
}

export function createMemoryStore(initial: Record<string, string> = {}): TextStore & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (n) => files.get(n) ?? null,
    write: async (n, t) => void files.set(n, t),
    remove: async (n) => void files.delete(n),
  };
}

/** Files are per user, so one account can never read another's unsent drafts on a shared phone. */
const safeId = (userId: string) => userId.replace(/[^A-Za-z0-9-]/g, '');
export const outboxFile = (userId: string) => `offline-outbox-${safeId(userId)}.json`;
export const referenceFile = (userId: string) => `offline-reference-${safeId(userId)}.json`;

const STATES = new Set(['pending', 'conflict', 'failed']);

function validOp(o: unknown): o is DraftOp {
  const x = o as Partial<DraftOp> | null;
  return (
    !!x &&
    typeof x.invoiceId === 'string' &&
    typeof x.isNew === 'boolean' &&
    typeof x.queuedAt === 'string' &&
    typeof x.state === 'string' &&
    STATES.has(x.state) &&
    (x.payload === null || (typeof x.payload === 'object' && x.payload !== undefined)) &&
    !!x.summary &&
    typeof x.summary === 'object'
  );
}

/** Reads the saved queue. A missing or damaged file is an empty queue, never a crash. */
export async function loadOutbox(store: TextStore, userId: string): Promise<OutboxState> {
  try {
    const text = await store.read(outboxFile(userId));
    if (!text) return EMPTY_OUTBOX;
    const parsed = JSON.parse(text) as { version?: number; ops?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.ops)) return EMPTY_OUTBOX;
    return { ops: parsed.ops.filter(validOp) };
  } catch {
    return EMPTY_OUTBOX;
  }
}

export async function saveOutbox(store: TextStore, userId: string, ops: DraftOp[]): Promise<void> {
  if (ops.length === 0) {
    await store.remove(outboxFile(userId));
    return;
  }
  await store.write(outboxFile(userId), JSON.stringify({ version: 1, ops }));
}
