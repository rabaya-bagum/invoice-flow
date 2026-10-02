import {
  estimateInputSchema,
  invoiceCreateSchema,
  estimateListQuerySchema,
  estimateTransitionSchema,
  invoiceInputSchema,
  invoiceListQuerySchema,
  taxRateInputSchema,
  transitionInputSchema,
} from '@invoiceflow/shared';
import type { Request, Response } from 'express';
import type { TaxRateRepository } from '../repositories/tax-rate-repository';
import type { EstimateService } from '../services/estimate-service';
import type { InvoiceService } from '../services/invoice-service';
import { notFound } from '../utils/errors';
import { businessId, idParam } from '../utils/http';

function actor(req: Request) {
  return { businessId: businessId(req), userId: req.user?.id as string, ip: req.ip };
}

export function createInvoiceController(svc: InvoiceService) {
  return {
    async list(req: Request, res: Response) {
      const { items, total } = await svc.list(
        businessId(req),
        invoiceListQuerySchema.parse(req.query),
      );
      res.json({ items, total });
    },
    get: async (req: Request, res: Response) =>
      void res.json(await svc.get(businessId(req), idParam(req))),
    async create(req: Request, res: Response) {
      const { id, ...input } = invoiceCreateSchema.parse(req.body);
      res.status(201).json(await svc.create(actor(req), input, id));
    },
    update: async (req: Request, res: Response) =>
      void res.json(await svc.update(actor(req), idParam(req), invoiceInputSchema.parse(req.body))),
    async remove(req: Request, res: Response) {
      await svc.remove(actor(req), idParam(req));
      res.status(204).end();
    },
    transition: async (req: Request, res: Response) =>
      void res.json(
        await svc.transition(actor(req), idParam(req), transitionInputSchema.parse(req.body).to),
      ),
    activity: async (req: Request, res: Response) =>
      void res.json({ items: await svc.activity(businessId(req), idParam(req)) }),
    /** GET /customers/:id/invoices */
    async forCustomer(req: Request, res: Response) {
      const q = invoiceListQuerySchema.parse({ ...req.query, customerId: idParam(req) });
      const { items, total } = await svc.listForCustomer(businessId(req), idParam(req), q);
      res.json({ items, total });
    },
  };
}

export function createTaxRateController(repo: TaxRateRepository) {
  return {
    list: async (req: Request, res: Response) =>
      void res.json({ items: await repo.list(businessId(req)) }),
    async create(req: Request, res: Response) {
      res.status(201).json(await repo.create(businessId(req), taxRateInputSchema.parse(req.body)));
    },
    async update(req: Request, res: Response) {
      const r = await repo.update(
        businessId(req),
        idParam(req),
        taxRateInputSchema.parse(req.body),
      );
      if (!r) throw notFound('Tax rate');
      res.json(r);
    },
    async remove(req: Request, res: Response) {
      if (!(await repo.delete(businessId(req), idParam(req)))) throw notFound('Tax rate');
      res.status(204).end();
    },
  };
}

export function createEstimateController(svc: EstimateService) {
  return {
    async list(req: Request, res: Response) {
      const { items, total } = await svc.list(
        businessId(req),
        estimateListQuerySchema.parse(req.query),
      );
      res.json({ items, total });
    },
    get: async (req: Request, res: Response) =>
      void res.json(await svc.get(businessId(req), idParam(req))),
    async create(req: Request, res: Response) {
      res.status(201).json(await svc.create(actor(req), estimateInputSchema.parse(req.body)));
    },
    update: async (req: Request, res: Response) =>
      void res.json(
        await svc.update(actor(req), idParam(req), estimateInputSchema.parse(req.body)),
      ),
    async remove(req: Request, res: Response) {
      await svc.remove(actor(req), idParam(req));
      res.status(204).end();
    },
    transition: async (req: Request, res: Response) =>
      void res.json(
        await svc.transition(actor(req), idParam(req), estimateTransitionSchema.parse(req.body).to),
      ),
    async convert(req: Request, res: Response) {
      res.status(201).json(await svc.convert(actor(req), idParam(req)));
    },
  };
}
