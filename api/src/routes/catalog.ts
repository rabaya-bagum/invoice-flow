import { Router } from 'express';
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

  r.get('/tax-rates', c.taxRates.list);
  r.post('/tax-rates', c.taxRates.create);
  r.put('/tax-rates/:id', c.taxRates.update);
  r.delete('/tax-rates/:id', c.taxRates.remove);
  return r;
}
