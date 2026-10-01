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
import {
  createDocumentController,
  createPublicController,
} from './controllers/document-controllers';
import {
  createPaymentController,
  createPublicPaymentHandler,
  createWebhookHandler,
  stripeReturnHandlers,
} from './controllers/payment-controllers';
import { createNotificationController } from './controllers/notification-controllers';
import { requireAuth } from './middleware/auth';
import { requireBusiness } from './middleware/business';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import type { BusinessRepository } from './repositories/business-repository';
import type { TaxRateRepository } from './repositories/tax-rate-repository';
import type { DocumentService } from './services/document-service';
import type { NotificationService } from './services/notification-service';
import type { PaymentService } from './services/payment-service';
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
  documentService: DocumentService;
  paymentService: PaymentService;
  notificationService: NotificationService;
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

  // Customer-facing, token-gated routes (no login). Tighter rate limit, never cached or indexed.
  const publicCtrl = createPublicController(deps.documentService, deps.paymentService);
  const publicLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.PUBLIC_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  });
  app.get('/pay/:token', publicLimiter, publicCtrl.page);
  app.get('/public/invoices/:token', publicLimiter, publicCtrl.json);
  app.get('/public/invoices/:token/pdf', publicLimiter, publicCtrl.pdf);
  app.post('/public/invoices/:token/view', publicLimiter, publicCtrl.view);
  app.post(
    '/public/invoices/:token/payment-intent',
    rateLimit({
      windowMs: 60_000,
      limit: config.PAYMENT_INTENT_RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    }),
    express.json({ limit: '2kb' }),
    createPublicPaymentHandler((t) => deps.documentService.resolve(t), deps.paymentService),
  );

  // Stripe -> us. Signature-verified against the RAW body, so it must be mounted before express.json.
  app.post(
    '/v1/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    createWebhookHandler(deps.paymentService, deps.notificationService.kick),
  );

  // Stripe onboarding landing pages (hand control back to the mobile app).
  app.get('/stripe/connect/return', stripeReturnHandlers.done);
  app.get('/stripe/connect/refresh', stripeReturnHandlers.refresh);

  // Apple Pay domain verification file (content is supplied by Stripe).
  app.get('/.well-known/apple-developer-merchantid-domain-association', (_req, res) => {
    if (!config.APPLE_PAY_DOMAIN_ASSOCIATION) {
      res.status(404).end();
      return;
    }
    res.type('text/plain').send(config.APPLE_PAY_DOMAIN_ASSOCIATION);
  });

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
      documents: createDocumentController(deps.documentService),
      payments: createPaymentController(deps.paymentService),
      notifications: createNotificationController(deps.notificationService),
      // Emails are costly and abusable: cap per signed-in user, not just per IP.
      sendLimiter: rateLimit({
        windowMs: 10 * 60_000,
        limit: config.SEND_RATE_LIMIT_PER_10_MIN,
        keyGenerator: (req) => req.user?.id ?? 'anonymous',
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many invoices sent. Please wait a few minutes.',
          },
        },
      }),
    }),
  );
  app.use('/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
