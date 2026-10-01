import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Requests per minute per client IP for /v1. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /** Requests per minute per IP for the public invoice routes. */
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  /** Invoice emails per signed-in user per 10 minutes. */
  SEND_RATE_LIMIT_PER_10_MIN: z.coerce.number().int().positive().default(20),
  /** Public base URL of this API, used in invoice links (the pay page is served at /pay/:token). */
  PUBLIC_APP_URL: z.string().url().default('http://localhost:4000'),
  /** HMAC key for share links. Min 32 chars. Rotating it invalidates every issued link. */
  PUBLIC_LINK_SECRET: z.string().min(32).optional(),
  /** Resend API key. Without it, emails are logged instead of sent (development only). */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** From address, e.g. "InvoiceFlow <invoices@yourdomain.com>" (domain verified with Resend). */
  EMAIL_FROM: z.string().min(3).default('InvoiceFlow <onboarding@resend.dev>'),
  /** Stripe secret key (sk_test_... / sk_live_...). Without it, online payments are disabled. */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  /** Signing secret of the webhook endpoint POST {PUBLIC_APP_URL}/v1/payments/webhook (whsec_...). */
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Publishable key (pk_...), sent to the pay page for Stripe.js. */
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  /** Platform fee on each online payment, in basis points (250 = 2.5%). */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(2000).default(0),
  /** Creating payment intents per minute per IP on the public page. */
  PAYMENT_INTENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** Contents of Stripe's Apple Pay domain association file, served at /.well-known/. */
  APPLE_PAY_DOMAIN_ASSOCIATION: z.string().min(1).optional(),
  /** Send real push notifications through Expo. Defaults to on in production, off elsewhere (logged only). */
  PUSH_ENABLED: z.enum(['true', 'false']).optional(),
  /** Optional Expo access token (needed only if "enhanced push security" is enabled in your Expo account). */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Comma-separated list of allowed browser origins (the public pay page). */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Only for legacy projects that sign tokens with HS256. Leave unset to verify via JWKS. */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

/** Parse and validate env. Fails fast with a readable message instead of booting half-configured. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    const missing = (
      [
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'PUBLIC_LINK_SECRET',
        'RESEND_API_KEY',
      ] as const
    ).filter((k) => !cfg[k]);
    if (missing.length)
      throw new Error(`Missing required env in production: ${missing.join(', ')}`);
  }
  return cfg;
}
