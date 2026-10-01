import { z } from 'zod';
import { isSupportedCurrency } from './currency';

/** Treat '' / whitespace as "not provided". */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Full-replacement text field: missing or blank becomes null. */
const text = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullish()).transform((v) => v ?? null);

/** Partial-update text field: undefined stays undefined (leave unchanged), blank clears to null. */
const textUpdate = (max: number) =>
  z
    .preprocess(blankToNull, z.string().trim().max(max).nullish())
    .transform((v) => (v === undefined ? undefined : (v ?? null)));

const email = z.preprocess(
  blankToNull,
  z.string().trim().toLowerCase().email('Enter a valid email address').max(254).nullish(),
);

const MAX_MINOR = 1_000_000_000_000;
const bps = z.number().int().min(0).max(10_000);

// ------------------------------------------------------------------ customers
export const customerInputSchema = z
  .object({
    firstName: text(100),
    lastName: text(100),
    companyName: text(150),
    email: email.transform((v) => v ?? null),
    phone: text(40),
    addressLine1: text(200),
    addressLine2: text(200),
    city: text(100),
    province: text(100),
    postalCode: text(20),
    country: text(100),
    notes: text(2000),
  })
  .refine((c) => c.firstName || c.lastName || c.companyName, {
    path: ['firstName'],
    message: 'Enter a name or a company name',
  });
export type CustomerInput = z.infer<typeof customerInputSchema>;

// ------------------------------------------------------------------ products
export const productInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(200),
  description: text(2000),
  priceMinor: z
    .number({ invalid_type_error: 'Enter a price' })
    .int()
    .min(0, 'Price cannot be negative')
    .max(MAX_MINOR, 'Price is too large'),
  unit: z
    .preprocess(blankToNull, z.string().trim().max(30).nullish())
    .transform((v) => v ?? 'unit'),
  taxRateBps: bps.default(0),
  sku: text(64),
  category: text(100),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInputSchema>;

// ------------------------------------------------------------------ business profile
const prefix = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z0-9\-_/]+$/, 'Use letters, numbers, - _ / only');

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

/** PUT /v1/business: only the fields provided are changed. */
export const businessUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a business name').max(150).optional(),
    ownerName: textUpdate(100),
    email: email.transform((v) => v),
    phone: textUpdate(40),
    addressLine1: textUpdate(200),
    addressLine2: textUpdate(200),
    city: textUpdate(100),
    province: textUpdate(100),
    postalCode: textUpdate(20),
    country: textUpdate(100),
    website: z.preprocess(
      blankToNull,
      z.string().trim().url('Enter a valid URL (https://...)').max(300).nullish(),
    ),
    taxNumber: textUpdate(60),
    defaultCurrency: z.string().refine(isSupportedCurrency, 'Unsupported currency').optional(),
    defaultTaxRateBps: bps.optional(),
    defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
    timezone: timezone.optional(),
    invoicePrefix: prefix.optional(),
    estimatePrefix: prefix.optional(),
    numberPadding: z.number().int().min(1).max(10).optional(),
    template: z.enum(['classic', 'modern', 'minimal']).optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #2563EB')
      .optional(),
    displayOptions: z.record(z.string().max(40), z.boolean()).optional(),
  })
  .strict();
export type BusinessUpdate = z.infer<typeof businessUpdateSchema>;

// ------------------------------------------------------------------ list queries
export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
