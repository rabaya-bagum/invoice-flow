import type { Database } from '../db';
import {
  createNotificationRepository,
  type NewNotification,
} from '../repositories/notification-repository';
import { AppError, notFound } from '../utils/errors';
import { EXPO_TOKEN, type PushSender } from './push';

const MAX_ATTEMPTS = 5;

export function createNotificationService(deps: {
  db: Database;
  sender: PushSender;
  log?: (m: string) => void;
}) {
  const { db, sender } = deps;
  const repo = () => createNotificationRepository(db);

  /**
   * Delivers queued notifications. Safe to run from several processes at once (rows are claimed with
   * SKIP LOCKED) and safe to call often. A provider outage leaves rows queued for the next run; a dead
   * device token is removed; after MAX_ATTEMPTS a notification is marked as given up on.
   */
  async function dispatchPending(limit = 50): Promise<number> {
    return db.transaction(async (tx) => {
      const r = createNotificationRepository(tx);
      const rows = await r.claimUnpushed(limit, MAX_ATTEMPTS);
      let delivered = 0;
      for (const row of rows) {
        const tokens = await r.tokensForBusiness(row.business_id);
        if (tokens.length === 0) {
          await r.markPushed(row.id, 'no_devices'); // nothing to deliver to: not an error
          continue;
        }
        try {
          const results = await sender.send(
            tokens.map((t) => ({
              to: t.token,
              title: row.title,
              body: row.body,
              data: { ...row.data, notificationId: row.id },
            })),
          );
          const dead = results
            .filter((x) => !x.ok && x.error === 'DeviceNotRegistered')
            .map((x) => x.to);
          await r.removeTokens(dead);
          if (results.some((x) => x.ok)) {
            await r.markPushed(row.id);
            delivered++;
          } else if (dead.length === results.length) {
            await r.markPushed(row.id, 'device_not_registered');
          } else {
            await r.markPushFailed(
              row.id,
              results.find((x) => !x.ok)?.error ?? 'unknown',
              row.push_attempts + 1 >= MAX_ATTEMPTS,
            );
          }
        } catch (e) {
          await r.markPushFailed(
            row.id,
            (e as Error).message,
            row.push_attempts + 1 >= MAX_ATTEMPTS,
          );
        }
      }
      return delivered;
    });
  }

  /** Fire-and-forget: used right after a transaction commits so pushes go out promptly. */
  const kick = () => {
    void dispatchPending().catch((e: Error) =>
      (deps.log ?? console.error)(`push dispatch failed: ${e.message}`),
    );
  };

  return {
    dispatchPending,
    kick,

    add: (n: NewNotification) => repo().add(n),

    async list(businessId: string, q: { unreadOnly: boolean; limit: number; offset: number }) {
      return repo().list(businessId, q);
    },
    async markRead(businessId: string, id: string) {
      if (!(await repo().markRead(businessId, id))) throw notFound('Notification');
    },
    markAllRead: (businessId: string) => repo().markAllRead(businessId),

    async registerToken(userId: string, token: string, platform: 'ios' | 'android') {
      if (!EXPO_TOKEN.test(token))
        throw new AppError(400, 'INVALID_PUSH_TOKEN', 'Invalid push token');
      await repo().upsertToken(userId, token, platform);
    },
    removeToken: (userId: string, token: string) => repo().removeToken(userId, token),
  };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
