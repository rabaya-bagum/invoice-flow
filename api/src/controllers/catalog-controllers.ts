import {
  businessUpdateSchema,
  customerInputSchema,
  listQuerySchema,
  productInputSchema,
} from '@invoiceflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type {
  BusinessService,
  CustomerService,
  ProductService,
} from '../services/catalog-services';
import { businessId, idParam } from '../utils/http';

export function createBusinessController(svc: BusinessService) {
  return {
    get: async (req: Request, res: Response) => void res.json(await svc.get(businessId(req))),
    update: async (req: Request, res: Response) =>
      void res.json(await svc.update(businessId(req), businessUpdateSchema.parse(req.body))),
  };
}

export function createCustomerController(svc: CustomerService) {
  return {
    async list(req: Request, res: Response) {
      const { items, total } = await svc.list(businessId(req), listQuerySchema.parse(req.query));
      res.json({ items, total });
    },
    get: async (req: Request, res: Response) =>
      void res.json(await svc.get(businessId(req), idParam(req))),
    async create(req: Request, res: Response) {
      res.status(201).json(await svc.create(businessId(req), customerInputSchema.parse(req.body)));
    },
    update: async (req: Request, res: Response) =>
      void res.json(
        await svc.update(businessId(req), idParam(req), customerInputSchema.parse(req.body)),
      ),
    async remove(req: Request, res: Response) {
      await svc.remove(businessId(req), idParam(req));
      res.status(204).end();
    },
  };
}

const productListQuery = listQuerySchema.extend({
  category: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).default('false'),
});

export function createProductController(svc: ProductService) {
  return {
    async list(req: Request, res: Response) {
      const q = productListQuery.parse(req.query);
      const { items, total } = await svc.list(businessId(req), {
        ...q,
        includeInactive: q.includeInactive === 'true',
      });
      res.json({ items, total });
    },
    get: async (req: Request, res: Response) =>
      void res.json(await svc.get(businessId(req), idParam(req))),
    async create(req: Request, res: Response) {
      res.status(201).json(await svc.create(businessId(req), productInputSchema.parse(req.body)));
    },
    update: async (req: Request, res: Response) =>
      void res.json(
        await svc.update(businessId(req), idParam(req), productInputSchema.parse(req.body)),
      ),
    async remove(req: Request, res: Response) {
      await svc.remove(businessId(req), idParam(req));
      res.status(204).end();
    },
  };
}
