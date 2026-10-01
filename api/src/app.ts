import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config';
import {
  createBusinessController,
  createCustomerController,
  createProductController,
} from './controllers/catalog-controllers';
import {
  createInvoiceController,
  createTaxRateController,
} from './controllers/invoice-controllers';
import { createMeController } from './controllers/me-controller';
import { requireAuth } from './middleware/auth';
import { requireBusiness } from './middleware/business';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import type { BusinessRepository } from './repositories/business-repository';
import type { TaxRateRepository } from './repositories/tax-rate-repository';
import type { InvoiceService } from './services/invoice-service';
import { createCatalogRouter } from './routes/catalog';
import { createMeRouter } from './routes/me';
import type { AccountService } from './services/account-service';
import type { BusinessService, CustomerService, ProductService } from './services/catalog-services';
import type { TokenVerifier } from './services/token-verifier';

export interface AppDeps {
  verifyToken: TokenVerifier;
  accountService: AccountService;
  businessRepo: BusinessRepository;
  businessService: BusinessService;
  customerService: CustomerService;
  productService: ProductService;
  invoiceService: InvoiceService;
  taxRateRepo: TaxRateRepository;
}

export function createApp(config: Config, deps: AppDeps) {
  const logger = pino({ level: config.LOG_LEVEL, redact: ['req.headers.authorization'] });
  const app = express();

  // Behind a TLS-terminating proxy in production; needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: false }));

  app.use(healthRouter);

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    }),
  );
  // The Stripe webhook (Phase 6) must be mounted BEFORE this so it can read the raw body.
  api.use(express.json({ limit: '100kb' }));
  // Everything below requires a verified Supabase session.
  api.use(requireAuth(deps.verifyToken));
  api.use(createMeRouter(createMeController(deps.accountService)));
  // Business-scoped routes: the business is resolved from the verified user, never from input.
  api.use(requireBusiness(deps.businessRepo));
  api.use(
    createCatalogRouter({
      business: createBusinessController(deps.businessService),
      customers: createCustomerController(deps.customerService),
      products: createProductController(deps.productService),
      invoices: createInvoiceController(deps.invoiceService),
      taxRates: createTaxRateController(deps.taxRateRepo),
    }),
  );
  app.use('/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
