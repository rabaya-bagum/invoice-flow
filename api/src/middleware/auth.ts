import type { RequestHandler } from 'express';
import type { AuthUser, TokenVerifier } from '../services/token-verifier';
import { AppError } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Requires `Authorization: Bearer <supabase access token>` and sets req.user. */
export function requireAuth(verify: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    const match = header ? /^Bearer (.+)$/i.exec(header) : null;
    if (!match?.[1]) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
    try {
      req.user = await verify(match[1]);
      next();
    } catch (err) {
      next(err);
    }
  };
}
