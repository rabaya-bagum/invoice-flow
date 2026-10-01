import type { Queryable } from '../db';

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NewNotification {
  businessId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushRow {
  id: string;
  business_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  push_attempts: number;
}

const COLS = `id, type, title, body, data, read_at AS "readAt", created_at AS "createdAt"`;

export interface NotificationRepository {
  /** Records a notification (and queues its push). Call inside the transaction that caused it. */
  add(n: NewNotification): Promise<string>;
  list(
    businessId: string,
    q: { unreadOnly: boolean; limit: number; offset: number },
  ): Promise<{ items: NotificationRecord[]; total: number; unread: number }>;
  markRead(businessId: string, id: string): Promise<boolean>;
  markAllRead(businessId: string): Promise<number>;

  // push tokens
  upsertToken(userId: string, token: string, platform: 'ios' | 'android'): Promise<void>;
  removeToken(userId: string, token: string): Promise<void>;
  removeTokens(tokens: string[]): Promise<void>;
  tokensForBusiness(businessId: string): Promise<Array<{ token: string; platform: string }>>;

  // outbox
  /** Locks up to `limit` unsent notifications (SKIP LOCKED, so parallel dispatchers never double-send). */
  claimUnpushed(limit: number, maxAttempts: number): Promise<PushRow[]>;
  markPushed(id: string, error?: string | null): Promise<void>;
  markPushFailed(id: string, error: string, giveUp: boolean): Promise<void>;
}

export function createNotificationRepository(db: Queryable): NotificationRepository {
  return {
    async add(n) {
      // clock_timestamp(): several rows in one transaction must keep their order.
      const r = await db.query<{ id: string }>(
        `INSERT INTO notifications (business_id, type, title, body, data, created_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp()) RETURNING id`,
        [n.businessId, n.type, n.title, n.body, JSON.stringify(n.data ?? {})],
      );
      return (r.rows[0] as { id: string }).id;
    },

    async list(businessId, q) {
      const where = `business_id = $1${q.unreadOnly ? ' AND read_at IS NULL' : ''}`;
      const items = await db.query<NotificationRecord>(
        `SELECT ${COLS} FROM notifications WHERE ${where} ORDER BY created_at DESC, id LIMIT ${q.limit} OFFSET ${q.offset}`,
        [businessId],
      );
      const counts = await db.query<{ total: string; unread: string }>(
        `SELECT count(*) FILTER (WHERE ${q.unreadOnly ? 'read_at IS NULL' : 'true'}) AS total,
                count(*) FILTER (WHERE read_at IS NULL) AS unread
         FROM notifications WHERE business_id = $1`,
        [businessId],
      );
      return {
        items: items.rows,
        total: Number(counts.rows[0]?.total ?? 0),
        unread: Number(counts.rows[0]?.unread ?? 0),
      };
    },

    async markRead(businessId, id) {
      const r = await db.query(
        'UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND business_id = $2',
        [id, businessId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async markAllRead(businessId) {
      const r = await db.query(
        'UPDATE notifications SET read_at = now() WHERE business_id = $1 AND read_at IS NULL',
        [businessId],
      );
      return r.rowCount ?? 0;
    },

    async upsertToken(userId, token, platform) {
      // A device token belongs to whoever signed in last on that device.
      await db.query(
        `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
        [userId, token, platform],
      );
    },

    async removeToken(userId, token) {
      await db.query('DELETE FROM push_tokens WHERE user_id = $1 AND token = $2', [userId, token]);
    },

    async removeTokens(tokens) {
      if (tokens.length)
        await db.query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [tokens]);
    },

    async tokensForBusiness(businessId) {
      const r = await db.query<{ token: string; platform: string }>(
        `SELECT t.token, t.platform FROM push_tokens t JOIN business_profiles b ON b.owner_id = t.user_id WHERE b.id = $1`,
        [businessId],
      );
      return r.rows;
    },

    async claimUnpushed(limit, maxAttempts) {
      const r = await db.query<PushRow>(
        `SELECT id, business_id, title, body, data, push_attempts FROM notifications
         WHERE push_sent_at IS NULL AND push_attempts < $2
         ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit, maxAttempts],
      );
      return r.rows;
    },

    async markPushed(id, error = null) {
      await db.query(
        'UPDATE notifications SET push_sent_at = now(), push_error = $2, push_attempts = push_attempts + 1 WHERE id = $1',
        [id, error],
      );
    },

    async markPushFailed(id, error, giveUp) {
      await db.query(
        `UPDATE notifications SET push_attempts = push_attempts + 1, push_error = $2,
           push_sent_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1`,
        [id, error, giveUp],
      );
    },
  };
}
