import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AccountService } from '../services/account-service';
import { AppError } from '../utils/errors';

const deleteBody = z.object({ confirm: z.literal('DELETE') });

function currentUser(req: Request) {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.user;
}

export function createMeController(service: AccountService) {
  return {
    async get(req: Request, res: Response) {
      res.json(await service.getMe(currentUser(req)));
    },

    async remove(req: Request, res: Response) {
      const user = currentUser(req);
      deleteBody.parse(req.body);
      await service.deleteAccount(user, req.ip);
      res.status(204).end();
    },
  };
}
