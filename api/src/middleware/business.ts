import type { RequestHandler } from 'express';
import type { BusinessRepository } from '../repositories/business-repository';
import { AppError } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The caller's business, resolved from the verified user id (never from the request). */
      businessId?: string;
    }
  }
}

/** Resolves req.businessId from req.user. Must run after requireAuth. */
export function requireBusiness(repo: BusinessRepository): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
      const id = await repo.findIdByOwner(req.user.id);
      if (!id) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
      req.businessId = id;
      next();
    } catch (err) {
      next(err);
    }
  };
}
