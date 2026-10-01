import { createClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { createAccountRepository } from './repositories/account-repository';
import { createBusinessRepository } from './repositories/business-repository';
import { createCustomerRepository } from './repositories/customer-repository';
import { createProductRepository } from './repositories/product-repository';
import { createAccountService } from './services/account-service';
import {
  createBusinessService,
  createCustomerService,
  createProductService,
} from './services/catalog-services';
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
const db = createPool(config.DATABASE_URL);
const businessRepo = createBusinessRepository(db);

const app = createApp(config, {
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
});

const server = app.listen(config.PORT, () => {
  console.log(`InvoiceFlow API listening on :${config.PORT} (${config.NODE_ENV})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => void db.end().then(() => process.exit(0)));
  });
}
