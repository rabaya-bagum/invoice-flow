import { Router, raw, type RequestHandler } from 'express';
import type { createNotificationController } from '../controllers/notification-controllers';
import type { createPaymentController } from '../controllers/payment-controllers';
import type { createDocumentController } from '../controllers/document-controllers';
import type {
  createInvoiceController,
  createTaxRateController,
} from '../controllers/invoice-controllers';
import type {
  createBusinessController,
  createCustomerController,
  createProductController,
} from '../controllers/catalog-controllers';

export function createCatalogRouter(c: {
  business: ReturnType<typeof createBusinessController>;
  customers: ReturnType<typeof createCustomerController>;
  products: ReturnType<typeof createProductController>;
  invoices: ReturnType<typeof createInvoiceController>;
  taxRates: ReturnType<typeof createTaxRateController>;
  documents: ReturnType<typeof createDocumentController>;
  payments: ReturnType<typeof createPaymentController>;
  notifications: ReturnType<typeof createNotificationController>;
  sendLimiter: RequestHandler;
}) {
  const r = Router();
  r.get('/business', c.business.get);
  r.put('/business', c.business.update);

  r.get('/customers', c.customers.list);
  r.post('/customers', c.customers.create);
  r.get('/customers/:id', c.customers.get);
  r.put('/customers/:id', c.customers.update);
  r.delete('/customers/:id', c.customers.remove);
  r.get('/customers/:id/invoices', c.invoices.forCustomer);

  r.get('/products', c.products.list);
  r.post('/products', c.products.create);
  r.get('/products/:id', c.products.get);
  r.put('/products/:id', c.products.update);
  r.delete('/products/:id', c.products.remove);

  r.get('/invoices', c.invoices.list);
  r.post('/invoices', c.invoices.create);
  r.get('/invoices/:id', c.invoices.get);
  r.put('/invoices/:id', c.invoices.update);
  r.delete('/invoices/:id', c.invoices.remove);
  r.post('/invoices/:id/transition', c.invoices.transition);
  r.get('/invoices/:id/activity', c.invoices.activity);

  r.post('/invoices/:id/pdf', c.documents.pdf);
  r.post('/invoices/:id/send', c.sendLimiter, c.documents.send);
  r.post('/invoices/:id/share-link', c.documents.shareLink);
  r.delete('/invoices/:id/share-link', c.documents.revokeShareLink);

  const image = raw({ type: ['image/png', 'image/jpeg'], limit: 1_000_000 });
  r.put('/business/:kind', image, c.documents.putAsset);
  r.get('/business/:kind', c.documents.getAsset);
  r.delete('/business/:kind', c.documents.removeAsset);

  r.get('/payments/connect/status', c.payments.connectStatus);
  r.post('/payments/connect/onboard', c.payments.connectOnboard);
  r.post('/payments/create-intent', c.payments.createIntent);
  r.get('/payments', c.payments.list);
  r.get('/payments/:id', c.payments.get);
  r.post('/payments/:id/refund', c.payments.refund);

  r.get('/notifications', c.notifications.list);
  r.post('/notifications/read-all', c.notifications.readAll);
  r.post('/notifications/:id/read', c.notifications.read);
  r.post('/push-tokens', c.notifications.registerToken);
  r.delete('/push-tokens', c.notifications.removeToken);

  r.get('/tax-rates', c.taxRates.list);
  r.post('/tax-rates', c.taxRates.create);
  r.put('/tax-rates/:id', c.taxRates.update);
  r.delete('/tax-rates/:id', c.taxRates.remove);
  return r;
}
