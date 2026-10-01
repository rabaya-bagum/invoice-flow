import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config';
import { createMeController } from './controllers/me-controller';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { createMeRouter } from './routes/me';
import type { AccountService } from './services/account-service';
import type { TokenVerifier } from './services/token-verifier';

export interface AppDeps {
  verifyToken: TokenVerifier;
  accountService: AccountService;
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
      limit: 120,
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
  app.use('/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
