import type { Request } from 'express';
import { z } from 'zod';
import { AppError, notFound } from './errors';

const uuid = z.string().uuid();

/** Route :id params must be UUIDs; anything else is a 404 (never reaches the database). */
export function idParam(req: Request, name = 'id'): string {
  const parsed = uuid.safeParse(req.params[name]);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export function businessId(req: Request): string {
  if (!req.businessId) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.businessId;
}
