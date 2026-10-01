import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DashboardService } from '../services/dashboard-service';
import { businessId } from '../utils/http';

const query = z.object({ period: z.enum(['all', 'this_month', 'this_year']).default('all') });

export function createDashboardController(svc: DashboardService) {
  return {
    async get(req: Request, res: Response) {
      const { period } = query.parse(req.query);
      res.json(await svc.get(businessId(req), period));
    },
  };
}
