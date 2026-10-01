import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.PORT, () => {
  console.log(`InvoiceFlow API listening on :${config.PORT} (${config.NODE_ENV})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
