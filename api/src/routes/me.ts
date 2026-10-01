import { Router } from 'express';
import type { createMeController } from '../controllers/me-controller';

export function createMeRouter(ctrl: ReturnType<typeof createMeController>) {
  const r = Router();
  r.get('/me', ctrl.get);
  r.delete('/me', ctrl.remove);
  return r;
}
