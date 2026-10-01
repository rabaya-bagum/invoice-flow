import { z } from 'zod';
import { isSupportedCurrency } from './currency';
import { isValidDate } from './dates';
import { MANUAL_TRANSITIONS } from './invoice-status';
import { listQuerySchema } from './schemas';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const text = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullish()).transform((v) => v ?? null);

const date = z.string().refine(isValidDate, 'Enter a valid date (YYYY-MM-DD)');
const bps = z.number().int().min(0).max(10_000);
const MAX_MINOR = 1_000_000_000_000;

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  rateBps: bps,
  isDefault: z.boolean().default(false),
});
export type TaxRateInput = z.infer<typeof taxRateInputSchema>;

export const invoiceItemInputSchema = z.object({
  productId: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  description: z.string().trim().min(1, 'Enter a description').max(2000),
  /** Thousandths of a unit: 1.5 -> 1500. */
  quantityMilli: z
    .number({ invalid_type_error: 'Enter a quantity' })
    .int()
    .min(0, 'Quantity cannot be negative')
    .max(999_999_999_999),
  unitPriceMinor: z
    .number({ invalid_type_error: 'Enter a price' })
    .int()
    .min(0, 'Price cannot be negative')
    .max(MAX_MINOR),
  taxes: z
    .array(z.object({ name: z.string().trim().min(1).max(60), rateBps: bps }))
    .max(5)
    .default([]),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;

/**
 * Client-supplied invoice content. Totals are deliberately absent: the server computes them and any
 * totals a client sends are ignored.
 */
export const invoiceInputSchema = z.object({
  customerId: z.string().uuid('Choose a customer'),
  /** Omit to auto-number (INV-0001, ...). */
  number: z
    .preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(/^[A-Za-z0-9\-_/. ]+$/, 'Use letters, numbers and - _ / .')
        .nullish(),
    )
    .transform((v) => v ?? null),
  issueDate: date,
  dueDate: date,
  currency: z.string().refine(isSupportedCurrency, 'Unsupported currency'),
  taxInclusive: z.boolean().default(false),
  discount: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('percent'), value: bps }),
      z.object({ type: z.literal('fixed'), value: z.number().int().min(0).max(MAX_MINOR) }),
    ])
    .nullish()
    .transform((v) => v ?? null),
  feesMinor: z.number().int().min(0).max(MAX_MINOR).default(0),
  notes: text(5000),
  terms: text(5000),
  items: z.array(invoiceItemInputSchema).min(1, 'Add at least one item').max(100),
  /** Optimistic concurrency: if sent on update and stale, the server answers 409. */
  version: z.number().int().min(1).optional(),
});
export type InvoiceWriteInput = z.infer<typeof invoiceInputSchema>;

export const transitionInputSchema = z.object({ to: z.enum(MANUAL_TRANSITIONS) });

const listStatus = z.enum([
  'draft',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
  'refunded',
  /** Everything still owed: sent, viewed and partially paid, overdue included. */
  'outstanding',
]);

export const invoiceListQuerySchema = listQuerySchema.extend({
  status: listStatus.optional(),
  from: date.optional(),
  to: date.optional(),
  customerId: z.string().uuid().optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

const emailAddr = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

/** POST /v1/invoices/:id/send. Everything is optional: defaults come from the customer and a template. */
export const sendInvoiceInputSchema = z.object({
  to: z.preprocess(blankToNull, emailAddr.nullish()).transform((v) => v ?? null),
  subject: z
    .preprocess(blankToNull, z.string().trim().max(200).nullish())
    .transform((v) => v ?? null),
  message: z
    .preprocess(blankToNull, z.string().trim().max(5000).nullish())
    .transform((v) => v ?? null),
});
export type SendInvoiceInput = z.infer<typeof sendInvoiceInputSchema>;
