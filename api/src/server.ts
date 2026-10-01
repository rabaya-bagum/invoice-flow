import { createClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { loadConfig } from './config';
import { createSupabaseAccountRepository } from './repositories/account-repository';
import { createAccountService } from './services/account-service';
import { tokenVerifierFromConfig } from './services/token-verifier';

const config = loadConfig();

if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

// Service-role client: bypasses RLS, so every repository call must be scoped by user/business.
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = createApp(config, {
  verifyToken: tokenVerifierFromConfig(config),
  accountService: createAccountService(createSupabaseAccountRepository(admin)),
});

const server = app.listen(config.PORT, () => {
  console.log(`InvoiceFlow API listening on :${config.PORT} (${config.NODE_ENV})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
