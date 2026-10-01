import type { Request, Response } from 'express';
import { z } from 'zod';
import type { NotificationService } from '../services/notification-service';
import { AppError } from '../utils/errors';
import { businessId, idParam } from '../utils/http';

const listQuery = z.object({
  unread: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const tokenBody = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android']),
});
const removeBody = z.object({ token: z.string().min(10).max(200) });

const userId = (req: Request) => {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.user.id;
};

export function createNotificationController(svc: NotificationService) {
  return {
    async list(req: Request, res: Response) {
      const q = listQuery.parse(req.query);
      res.json(
        await svc.list(businessId(req), {
          unreadOnly: q.unread === 'true',
          limit: q.limit,
          offset: q.offset,
        }),
      );
    },
    async read(req: Request, res: Response) {
      await svc.markRead(businessId(req), idParam(req));
      res.status(204).end();
    },
    async readAll(req: Request, res: Response) {
      res.json({ updated: await svc.markAllRead(businessId(req)) });
    },
    async registerToken(req: Request, res: Response) {
      const b = tokenBody.parse(req.body);
      await svc.registerToken(userId(req), b.token, b.platform);
      res.status(204).end();
    },
    async removeToken(req: Request, res: Response) {
      await svc.removeToken(userId(req), removeBody.parse(req.body).token);
      res.status(204).end();
    },
  };
}
