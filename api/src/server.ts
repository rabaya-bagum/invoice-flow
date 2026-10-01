import { createClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDatabase, createPool } from './db';
import { createAccountRepository } from './repositories/account-repository';
import { createBusinessRepository } from './repositories/business-repository';
import { createCustomerRepository } from './repositories/customer-repository';
import { createTaxRateRepository } from './repositories/tax-rate-repository';
import { createProductRepository } from './repositories/product-repository';
import { createAccountService } from './services/account-service';
import {
  createBusinessService,
  createCustomerService,
  createProductService,
} from './services/catalog-services';
import { createSupabaseAssetStorage, ensureAssetBucket } from './services/asset-storage';
import { createDashboardService } from './services/dashboard-service';
import { createExpoPushSender, createLogPushSender } from './services/push';
import { createNotificationService } from './services/notification-service';
import { createOverdueService, startSchedulers } from './services/overdue-service';
import { createPaymentService } from './services/payment-service';
import { createStripeGateway } from './services/stripe-gateway';
import { createDocumentService } from './services/document-service';
import { createEmailSender } from './services/email';
import { createInvoiceService } from './services/invoice-service';
import { tokenVerifierFromConfig } from './services/token-verifier';

const config = loadConfig();

if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY || !config.DATABASE_URL) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL are required');
}

// Service-role Supabase client: used only to delete auth users.
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Direct Postgres connection (bypasses RLS): every repository query is scoped by business_id.
const pool = createPool(config.DATABASE_URL);
const db = createDatabase(pool);
const businessRepo = createBusinessRepository(db);

const linkSecret =
  config.PUBLIC_LINK_SECRET ??
  (config.NODE_ENV === 'production'
    ? (() => {
        throw new Error('PUBLIC_LINK_SECRET is required in production');
      })()
    : 'dev-only-insecure-link-secret-change-me');
const invoiceService = createInvoiceService(db);
// Private bucket for logos/signatures; no-op if it already exists.
void ensureAssetBucket(admin).catch((e: Error) =>
  console.error('Could not ensure asset bucket:', e.message),
);

const pushEnabled = config.PUSH_ENABLED
  ? config.PUSH_ENABLED === 'true'
  : config.NODE_ENV === 'production';
const notificationService = createNotificationService({
  db,
  sender: pushEnabled ? createExpoPushSender(config.EXPO_ACCESS_TOKEN) : createLogPushSender(),
});
const overdueService = createOverdueService(db);

const app = createApp(config, {
  notificationService,
  dashboardService: createDashboardService(db),
  verifyToken: tokenVerifierFromConfig(config),
  accountService: createAccountService(
    createAccountRepository(db, async (userId) => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    }),
  ),
  businessRepo,
  businessService: createBusinessService(businessRepo),
  customerService: createCustomerService(createCustomerRepository(db)),
  productService: createProductService(createProductRepository(db)),
  invoiceService,
  taxRateRepo: createTaxRateRepository(db),
  paymentService: createPaymentService({
    db,
    invoices: invoiceService,
    businesses: businessRepo,
    gateway:
      config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
        ? createStripeGateway(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET)
        : null,
    config,
  }),
  documentService: createDocumentService({
    afterNotify: notificationService.kick,
    db,
    invoices: invoiceService,
    businesses: businessRepo,
    assets: createSupabaseAssetStorage(admin),
    email: createEmailSender(config),
    config: { ...config, linkSecret },
  }),
});

// Background jobs. Hourly overdue sweep (each business flips at its own local midnight) and a
// 30-second push retry loop. Both are safe to run in several instances at once.
const stopJobs = startSchedulers([
  {
    name: 'overdue-sweep',
    everyMs: 60 * 60_000,
    initialDelayMs: 30_000,
    run: async () => {
      if ((await overdueService.sweep()) > 0) notificationService.kick();
    },
  },
  {
    name: 'push-dispatch',
    everyMs: 30_000,
    initialDelayMs: 10_000,
    run: () => notificationService.dispatchPending(),
  },
]);

const server = app.listen(config.PORT, () => {
  console.log(`InvoiceFlow API listening on :${config.PORT} (${config.NODE_ENV})`);
});

// Keep-alive connections would otherwise hold server.close() open until the orchestrator kills us.
const SHUTDOWN_GRACE_MS = 10_000;
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    stopJobs();
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    server.close(() => void pool.end().then(() => process.exit(0)));
    server.closeIdleConnections();
  });
}

// A stray rejected promise must be visible, not silently swallowed (and never leak request data).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});
