/**
 * Builds docs/openapi.json and docs/invoiceflow.postman_collection.json from the table below.
 * `pnpm --filter @invoiceflow/api docs:build` rewrites them; a test fails if they are stale or if a
 * route in src/routes (or app.ts) is missing from the table.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

type Method = 'get' | 'post' | 'put' | 'delete';
interface Op {
  method: Method;
  path: string; // OpenAPI style: /v1/invoices/{id}
  tag: string;
  summary: string;
  body?: string; // schema name
  query?: string[];
  ok?: string; // response schema name
  status?: number;
  auth?: 'user' | 'public' | 'stripe';
  note?: string;
}

const Q_LIST = ['search', 'limit', 'offset'];

export const OPS: Op[] = [
  { method: 'get', path: '/health', tag: 'System', summary: 'Liveness probe', auth: 'public' },
  { method: 'get', path: '/v1/me', tag: 'Account', summary: 'Current user and business', ok: 'Me' },
  {
    method: 'delete',
    path: '/v1/me',
    tag: 'Account',
    summary: 'Delete the account and all its data',
    body: 'DeleteAccount',
    status: 204,
  },
  {
    method: 'get',
    path: '/v1/dashboard',
    tag: 'Dashboard',
    summary: 'Totals per currency, recent invoices and payments',
    query: ['period'],
    ok: 'Dashboard',
  },
  {
    method: 'get',
    path: '/v1/business',
    tag: 'Business',
    summary: 'Business profile',
    ok: 'Business',
  },
  {
    method: 'put',
    path: '/v1/business',
    tag: 'Business',
    summary: 'Update business profile (only sent fields change)',
    body: 'BusinessUpdate',
    ok: 'Business',
  },
  {
    method: 'put',
    path: '/v1/business/{kind}',
    tag: 'Business',
    summary: 'Upload logo or signature (kind = logo | signature; PNG/JPEG, max 1 MB)',
  },
  {
    method: 'get',
    path: '/v1/business/{kind}',
    tag: 'Business',
    summary: 'Download logo or signature',
  },
  {
    method: 'delete',
    path: '/v1/business/{kind}',
    tag: 'Business',
    summary: 'Remove logo or signature',
    status: 204,
  },
  {
    method: 'get',
    path: '/v1/customers',
    tag: 'Customers',
    summary: 'List customers',
    query: Q_LIST,
    ok: 'CustomerPage',
  },
  {
    method: 'post',
    path: '/v1/customers',
    tag: 'Customers',
    summary: 'Create a customer',
    body: 'CustomerInput',
    ok: 'Customer',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/customers/{id}',
    tag: 'Customers',
    summary: 'Get a customer',
    ok: 'Customer',
  },
  {
    method: 'put',
    path: '/v1/customers/{id}',
    tag: 'Customers',
    summary: 'Replace a customer',
    body: 'CustomerInput',
    ok: 'Customer',
  },
  {
    method: 'delete',
    path: '/v1/customers/{id}',
    tag: 'Customers',
    summary: 'Soft-delete a customer (invoices keep their history)',
    status: 204,
  },
  {
    method: 'get',
    path: '/v1/customers/{id}/invoices',
    tag: 'Customers',
    summary: "A customer's invoices",
    query: ['status', 'from', 'to', ...Q_LIST],
    ok: 'InvoicePage',
  },
  {
    method: 'get',
    path: '/v1/products',
    tag: 'Products',
    summary: 'List products and services',
    query: ['category', 'includeInactive', ...Q_LIST],
    ok: 'ProductPage',
  },
  {
    method: 'post',
    path: '/v1/products',
    tag: 'Products',
    summary: 'Create a product',
    body: 'ProductInput',
    ok: 'Product',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/products/{id}',
    tag: 'Products',
    summary: 'Get a product',
    ok: 'Product',
  },
  {
    method: 'put',
    path: '/v1/products/{id}',
    tag: 'Products',
    summary: 'Replace a product',
    body: 'ProductInput',
    ok: 'Product',
  },
  {
    method: 'delete',
    path: '/v1/products/{id}',
    tag: 'Products',
    summary: 'Delete a product',
    status: 204,
  },
  { method: 'get', path: '/v1/tax-rates', tag: 'Tax rates', summary: 'List tax rates' },
  {
    method: 'post',
    path: '/v1/tax-rates',
    tag: 'Tax rates',
    summary: 'Create a tax rate',
    body: 'TaxRateInput',
    status: 201,
  },
  {
    method: 'put',
    path: '/v1/tax-rates/{id}',
    tag: 'Tax rates',
    summary: 'Update a tax rate',
    body: 'TaxRateInput',
  },
  {
    method: 'delete',
    path: '/v1/tax-rates/{id}',
    tag: 'Tax rates',
    summary: 'Delete a tax rate',
    status: 204,
  },
  {
    method: 'get',
    path: '/v1/invoices',
    tag: 'Invoices',
    summary: 'List invoices (status filter includes overdue and outstanding)',
    query: ['status', 'from', 'to', 'customerId', ...Q_LIST],
    ok: 'InvoicePage',
  },
  {
    method: 'post',
    path: '/v1/invoices',
    tag: 'Invoices',
    summary: 'Create an invoice (totals are computed by the server)',
    body: 'InvoiceInput',
    ok: 'Invoice',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/invoices/{id}',
    tag: 'Invoices',
    summary: 'Get an invoice with items and tax breakdown',
    ok: 'Invoice',
  },
  {
    method: 'put',
    path: '/v1/invoices/{id}',
    tag: 'Invoices',
    summary: 'Replace an invoice (only before money is paid)',
    body: 'InvoiceInput',
    ok: 'Invoice',
  },
  {
    method: 'delete',
    path: '/v1/invoices/{id}',
    tag: 'Invoices',
    summary: 'Delete a draft',
    status: 204,
  },
  {
    method: 'post',
    path: '/v1/invoices/{id}/transition',
    tag: 'Invoices',
    summary: 'Move to sent, cancelled or paid (allowed transitions only)',
    body: 'Transition',
    ok: 'Invoice',
  },
  {
    method: 'get',
    path: '/v1/invoices/{id}/activity',
    tag: 'Invoices',
    summary: 'Activity timeline',
  },
  {
    method: 'get',
    path: '/v1/estimates',
    tag: 'Estimates',
    summary: 'List estimates (status filter includes derived "expired")',
    query: ['status', 'from', 'to', 'customerId', ...Q_LIST],
    ok: 'EstimatePage',
  },
  {
    method: 'post',
    path: '/v1/estimates',
    tag: 'Estimates',
    summary: 'Create an estimate (numbered EST-0001..; totals computed by the server)',
    body: 'EstimateInput',
    ok: 'Estimate',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/estimates/{id}',
    tag: 'Estimates',
    summary: 'Get an estimate',
    ok: 'Estimate',
  },
  {
    method: 'put',
    path: '/v1/estimates/{id}',
    tag: 'Estimates',
    summary: 'Replace an estimate (until accepted, declined or converted)',
    body: 'EstimateInput',
    ok: 'Estimate',
  },
  {
    method: 'delete',
    path: '/v1/estimates/{id}',
    tag: 'Estimates',
    summary: 'Delete a draft estimate',
    status: 204,
  },
  {
    method: 'post',
    path: '/v1/estimates/{id}/transition',
    tag: 'Estimates',
    summary: "Mark sent, accepted or declined (the owner records the customer's decision)",
    body: 'EstimateTransition',
    ok: 'Estimate',
  },
  {
    method: 'post',
    path: '/v1/estimates/{id}/convert',
    tag: 'Estimates',
    summary: 'Turn into a DRAFT invoice with the same lines, once, atomically',
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/estimates/{id}/pdf',
    tag: 'Estimates',
    summary: 'Render the estimate as a PDF',
  },
  {
    method: 'post',
    path: '/v1/estimates/{id}/send',
    tag: 'Estimates',
    summary: 'Email the estimate PDF (marks a draft as sent only after delivery)',
    body: 'SendInvoice',
  },
  {
    method: 'post',
    path: '/v1/invoices/{id}/pdf',
    tag: 'Documents',
    summary: 'Render the invoice as a PDF',
  },
  {
    method: 'post',
    path: '/v1/invoices/{id}/send',
    tag: 'Documents',
    summary: 'Email the invoice (marks a draft as sent only after delivery)',
    body: 'SendInvoice',
  },
  {
    method: 'post',
    path: '/v1/invoices/{id}/share-link',
    tag: 'Documents',
    summary: 'Create (or return) the public pay link',
  },
  {
    method: 'delete',
    path: '/v1/invoices/{id}/share-link',
    tag: 'Documents',
    summary: 'Revoke the public pay link',
    status: 204,
  },
  {
    method: 'get',
    path: '/v1/payments/connect/status',
    tag: 'Payments',
    summary: 'Stripe Connect status',
  },
  {
    method: 'post',
    path: '/v1/payments/connect/onboard',
    tag: 'Payments',
    summary: 'Start or resume Stripe Connect onboarding',
  },
  {
    method: 'post',
    path: '/v1/payments/create-intent',
    tag: 'Payments',
    summary: 'Create a PaymentIntent for an invoice',
    body: 'CreateIntent',
  },
  {
    method: 'get',
    path: '/v1/payments',
    tag: 'Payments',
    summary: 'Payment history',
    query: ['status', ...Q_LIST],
  },
  { method: 'get', path: '/v1/payments/{id}', tag: 'Payments', summary: 'Payment detail' },
  {
    method: 'post',
    path: '/v1/payments/{id}/refund',
    tag: 'Payments',
    summary: 'Refund fully or partially (applied when Stripe confirms)',
    body: 'Refund',
    status: 202,
  },
  {
    method: 'get',
    path: '/v1/notifications',
    tag: 'Notifications',
    summary: 'Notification centre',
  },
  {
    method: 'post',
    path: '/v1/notifications/read-all',
    tag: 'Notifications',
    summary: 'Mark all read',
  },
  {
    method: 'post',
    path: '/v1/notifications/{id}/read',
    tag: 'Notifications',
    summary: 'Mark one read',
  },
  {
    method: 'post',
    path: '/v1/push-tokens',
    tag: 'Notifications',
    summary: 'Register an Expo push token',
    body: 'PushToken',
    status: 204,
  },
  {
    method: 'delete',
    path: '/v1/push-tokens',
    tag: 'Notifications',
    summary: 'Remove a push token',
    body: 'PushTokenRemove',
    status: 204,
  },
  {
    method: 'post',
    path: '/v1/payments/webhook',
    tag: 'Webhooks',
    summary: 'Stripe webhook (signature-verified, raw body)',
    auth: 'stripe',
  },
  {
    method: 'get',
    path: '/pay/{token}',
    tag: 'Public',
    summary: 'Customer-facing invoice and pay page (HTML)',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/public/invoices/{token}',
    tag: 'Public',
    summary: 'Sanitised invoice JSON',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/public/invoices/{token}/pdf',
    tag: 'Public',
    summary: 'Invoice PDF',
    auth: 'public',
  },
  {
    method: 'post',
    path: '/public/invoices/{token}/view',
    tag: 'Public',
    summary: 'Record that the customer viewed the invoice',
    auth: 'public',
    status: 204,
  },
  {
    method: 'post',
    path: '/public/invoices/{token}/payment-intent',
    tag: 'Public',
    summary: 'Start a payment from the public page',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/stripe/connect/return',
    tag: 'Public',
    summary: 'Stripe onboarding return page',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/stripe/connect/refresh',
    tag: 'Public',
    summary: 'Stripe onboarding refresh page',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/.well-known/apple-developer-merchantid-domain-association',
    tag: 'Public',
    summary: 'Apple Pay domain verification file',
    auth: 'public',
  },
];

const money = { type: 'integer', description: 'Integer minor units (cents).', minimum: 0 };
const uuid = { type: 'string', format: 'uuid' };
const str = (max?: number) => ({ type: 'string', ...(max ? { maxLength: max } : {}) });
const nul = (s: object) => ({ ...s, nullable: true });
const page = (ref: string) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: { $ref: `#/components/schemas/${ref}` } },
    total: { type: 'integer' },
  },
});

const customerProps = {
  firstName: nul(str(100)),
  lastName: nul(str(100)),
  companyName: nul(str(150)),
  email: nul({ type: 'string', format: 'email' }),
  phone: nul(str(40)),
  addressLine1: nul(str(200)),
  addressLine2: nul(str(200)),
  city: nul(str(100)),
  province: nul(str(100)),
  postalCode: nul(str(20)),
  country: nul(str(100)),
  notes: nul(str(2000)),
};

export const SCHEMAS: Record<string, object> = {
  Error: {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string' },
          details: {},
        },
      },
    },
  },
  Me: {
    type: 'object',
    properties: { user: { type: 'object' }, business: { $ref: '#/components/schemas/Business' } },
  },
  DeleteAccount: {
    type: 'object',
    required: ['confirm'],
    properties: { confirm: { type: 'string', enum: ['DELETE'] } },
  },
  Business: {
    type: 'object',
    description: 'Business profile, defaults and numbering settings.',
    additionalProperties: true,
  },
  BusinessUpdate: {
    type: 'object',
    description: 'Any subset of the business fields (unknown fields are rejected).',
    additionalProperties: true,
  },
  CustomerInput: {
    type: 'object',
    description: 'At least one of firstName, lastName, companyName is required.',
    properties: customerProps,
  },
  Customer: {
    type: 'object',
    properties: { id: uuid, ...customerProps, createdAt: str(), updatedAt: str() },
  },
  CustomerPage: page('Customer'),
  ProductInput: {
    type: 'object',
    required: ['name', 'priceMinor'],
    properties: {
      name: str(200),
      description: nul(str(2000)),
      priceMinor: money,
      unit: str(30),
      taxRateBps: { type: 'integer', minimum: 0, maximum: 10000 },
      sku: nul(str(64)),
      category: nul(str(100)),
      isActive: { type: 'boolean' },
    },
  },
  Product: { type: 'object', additionalProperties: true, properties: { id: uuid } },
  ProductPage: page('Product'),
  TaxRateInput: {
    type: 'object',
    required: ['name', 'rateBps'],
    properties: {
      name: str(60),
      rateBps: { type: 'integer', minimum: 0, maximum: 10000, description: '500 = 5%' },
      isDefault: { type: 'boolean' },
    },
  },
  InvoiceItemInput: {
    type: 'object',
    required: ['description', 'quantityMilli', 'unitPriceMinor'],
    properties: {
      productId: nul(uuid),
      description: str(2000),
      quantityMilli: {
        type: 'integer',
        minimum: 0,
        description: 'Thousandths of a unit: 1.5 = 1500',
      },
      unitPriceMinor: money,
      taxes: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          required: ['name', 'rateBps'],
          properties: { name: str(60), rateBps: { type: 'integer', minimum: 0, maximum: 10000 } },
        },
      },
    },
  },
  InvoiceInput: {
    type: 'object',
    required: ['customerId', 'issueDate', 'dueDate', 'currency', 'items'],
    description: 'Totals are never accepted; the server computes them. Unknown fields are ignored.',
    properties: {
      customerId: uuid,
      number: nul(str(40)),
      issueDate: { type: 'string', format: 'date' },
      dueDate: { type: 'string', format: 'date' },
      currency: { type: 'string', example: 'USD' },
      taxInclusive: { type: 'boolean' },
      discount: nul({
        type: 'object',
        required: ['type', 'value'],
        properties: {
          type: { type: 'string', enum: ['percent', 'fixed'] },
          value: {
            type: 'integer',
            description: 'Basis points for percent, minor units for fixed',
          },
        },
      }),
      feesMinor: money,
      notes: nul(str(5000)),
      terms: nul(str(5000)),
      version: { type: 'integer', description: 'Optimistic concurrency: stale versions get 409' },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { $ref: '#/components/schemas/InvoiceItemInput' },
      },
    },
  },
  Invoice: {
    type: 'object',
    additionalProperties: true,
    properties: {
      id: uuid,
      number: str(),
      status: {
        type: 'string',
        enum: ['draft', 'sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded'],
      },
      displayStatus: {
        type: 'string',
        description: 'status, or "overdue" (derived from due date and balance)',
      },
      totalMinor: money,
      amountPaidMinor: money,
      balanceDueMinor: money,
      editable: { type: 'boolean' },
    },
  },
  InvoicePage: page('Invoice'),
  EstimateInput: {
    type: 'object',
    required: ['customerId', 'issueDate', 'expiryDate', 'currency', 'items'],
    description: 'Same as InvoiceInput, with expiryDate instead of dueDate.',
    properties: {
      customerId: uuid,
      number: nul(str(40)),
      issueDate: { type: 'string', format: 'date' },
      expiryDate: { type: 'string', format: 'date' },
      currency: { type: 'string', example: 'USD' },
      taxInclusive: { type: 'boolean' },
      discount: nul({
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['percent', 'fixed'] },
          value: { type: 'integer' },
        },
      }),
      feesMinor: money,
      notes: nul(str(5000)),
      terms: nul(str(5000)),
      version: { type: 'integer' },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { $ref: '#/components/schemas/InvoiceItemInput' },
      },
    },
  },
  Estimate: {
    type: 'object',
    additionalProperties: true,
    properties: {
      id: uuid,
      number: str(),
      status: { type: 'string', enum: ['draft', 'sent', 'viewed', 'accepted', 'rejected'] },
      displayStatus: {
        type: 'string',
        description: 'status, or "expired" (derived from the expiry date)',
      },
      totalMinor: money,
      convertedInvoiceId: nul(uuid),
      editable: { type: 'boolean' },
      convertible: { type: 'boolean' },
    },
  },
  EstimatePage: page('Estimate'),
  EstimateTransition: {
    type: 'object',
    required: ['to'],
    properties: { to: { type: 'string', enum: ['sent', 'accepted', 'rejected'] } },
  },
  Transition: {
    type: 'object',
    required: ['to'],
    properties: { to: { type: 'string', enum: ['sent', 'cancelled', 'paid'] } },
  },
  SendInvoice: {
    type: 'object',
    properties: {
      to: nul({ type: 'string', format: 'email' }),
      subject: nul(str(200)),
      message: nul(str(5000)),
    },
  },
  CreateIntent: {
    type: 'object',
    required: ['invoiceId'],
    properties: {
      invoiceId: uuid,
      amountMinor: {
        ...money,
        description: 'Omit to pay the full balance; smaller values are partial payments',
      },
    },
  },
  Refund: {
    type: 'object',
    properties: { amountMinor: { ...money, description: 'Omit for a full refund' } },
  },
  PushToken: {
    type: 'object',
    required: ['token', 'platform'],
    properties: { token: str(200), platform: { type: 'string', enum: ['ios', 'android'] } },
  },
  PushTokenRemove: { type: 'object', required: ['token'], properties: { token: str(200) } },
  CurrencyTotals: {
    type: 'object',
    properties: {
      currency: str(),
      outstandingMinor: money,
      outstandingCount: { type: 'integer' },
      overdueMinor: money,
      overdueCount: { type: 'integer' },
      draftMinor: money,
      draftCount: { type: 'integer' },
      paidMinor: money,
      paidCount: { type: 'integer' },
    },
  },
  Dashboard: {
    type: 'object',
    properties: {
      businessName: str(),
      defaultCurrency: str(),
      period: { type: 'string', enum: ['all', 'this_month', 'this_year'] },
      currencies: {
        type: 'array',
        description: 'Default currency first. Never summed across currencies.',
        items: { $ref: '#/components/schemas/CurrencyTotals' },
      },
      recentInvoices: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } },
      recentPayments: { type: 'array', items: { type: 'object' } },
    },
  },
};

const toParam = (name: string, where: 'path' | 'query') => ({
  name,
  in: where,
  required: where === 'path',
  schema:
    name === 'limit' || name === 'offset'
      ? { type: 'integer' }
      : name === 'id' || name === 'customerId'
        ? uuid
        : { type: 'string' },
});

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [
      ...[...op.path.matchAll(/\{(\w+)\}/g)].map((m) => toParam(m[1] as string, 'path')),
      ...(op.query ?? []).map((q) => toParam(q, 'query')),
    ];
    const status = String(op.status ?? 200);
    const secured = (op.auth ?? 'user') === 'user';
    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      operationId: `${op.method}_${op.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      ...(params.length ? { parameters: params } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${op.body}` } },
              },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: status === '204' ? 'No content' : 'Success',
          ...(op.ok
            ? {
                content: {
                  'application/json': { schema: { $ref: `#/components/schemas/${op.ok}` } },
                },
              }
            : {}),
        },
        ...(secured
          ? {
              '401': {
                description: 'Missing or invalid session',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
              '404': { description: "Not found (also returned for another business's ids)" },
            }
          : {}),
        '400': {
          description: 'Validation error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '429': { description: 'Rate limited' },
      },
      ...(secured ? { security: [{ supabaseJwt: [] }] } : { security: [] }),
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'InvoiceFlow API',
      version: '1.0.0',
      description:
        'Money is always integer minor units. Authenticated routes need a Supabase access token. Cross-business ids answer 404. Generated by api/scripts/build-docs.ts.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local' }],
    tags: [...new Set(OPS.map((o) => o.tag))].map((name) => ({ name })),
    components: {
      securitySchemes: { supabaseJwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: SCHEMAS,
    },
    paths,
  };
}

const EXAMPLES: Record<string, unknown> = {
  CustomerInput: { companyName: 'Acme Ltd', email: 'billing@acme.test' },
  ProductInput: { name: 'Consulting', priceMinor: 15000, unit: 'hour', taxRateBps: 500 },
  TaxRateInput: { name: 'GST', rateBps: 500, isDefault: true },
  InvoiceInput: {
    customerId: '{{customerId}}',
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    currency: 'USD',
    items: [
      {
        description: 'Consulting',
        quantityMilli: 2000,
        unitPriceMinor: 15000,
        taxes: [{ name: 'GST', rateBps: 500 }],
      },
    ],
  },
  Transition: { to: 'sent' },
  EstimateTransition: { to: 'accepted' },
  EstimateInput: {
    customerId: '{{customerId}}',
    issueDate: '2026-10-01',
    expiryDate: '2026-10-31',
    currency: 'USD',
    items: [
      {
        description: 'Consulting',
        quantityMilli: 2000,
        unitPriceMinor: 15000,
        taxes: [{ name: 'GST', rateBps: 500 }],
      },
    ],
  },
  SendInvoice: {},
  CreateIntent: { invoiceId: '{{invoiceId}}' },
  Refund: {},
  PushToken: { token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'ios' },
  PushTokenRemove: { token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' },
  DeleteAccount: { confirm: 'DELETE' },
  BusinessUpdate: { name: 'My Studio' },
};

export function buildPostman() {
  const tags = [...new Set(OPS.map((o) => o.tag))];
  return {
    info: {
      name: 'InvoiceFlow API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description:
        'Set baseUrl and accessToken (a Supabase access token). Generated by api/scripts/build-docs.ts.',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:4000' },
      { key: 'accessToken', value: '' },
      { key: 'id', value: '' },
      { key: 'customerId', value: '' },
      { key: 'invoiceId', value: '' },
      { key: 'token', value: '' },
      { key: 'kind', value: 'logo' },
    ],
    item: tags.map((tag) => ({
      name: tag,
      item: OPS.filter((o) => o.tag === tag).map((o) => {
        const url = o.path.replace(/\{(\w+)\}/g, ':$1');
        const [pathPart] = url.split('?');
        return {
          name: `${o.method.toUpperCase()} ${o.path}`,
          request: {
            method: o.method.toUpperCase(),
            header: o.body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
            ...((o.auth ?? 'user') === 'user' ? {} : { auth: { type: 'noauth' } }),
            url: {
              raw: `{{baseUrl}}${pathPart}`,
              host: ['{{baseUrl}}'],
              path: (pathPart as string).split('/').filter(Boolean),
              variable: [...o.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
                key: m[1],
                value: `{{${m[1]}}}`,
              })),
              query: (o.query ?? []).map((q) => ({ key: q, value: '', disabled: true })),
            },
            ...(o.body
              ? { body: { mode: 'raw', raw: JSON.stringify(EXAMPLES[o.body] ?? {}, null, 2) } }
              : {}),
            description: o.summary,
          },
        };
      }),
    })),
  };
}

if (require.main === module) {
  const docs = path.join(__dirname, '../../docs');
  writeFileSync(path.join(docs, 'openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n');
  writeFileSync(
    path.join(docs, 'invoiceflow.postman_collection.json'),
    JSON.stringify(buildPostman(), null, 2) + '\n',
  );
  console.log(
    `Wrote docs/openapi.json and docs/invoiceflow.postman_collection.json (${OPS.length} operations)`,
  );
}
