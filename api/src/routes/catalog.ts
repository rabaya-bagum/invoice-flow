import { Router } from 'express';
import type {
  createBusinessController,
  createCustomerController,
  createProductController,
} from '../controllers/catalog-controllers';

export function createCatalogRouter(c: {
  business: ReturnType<typeof createBusinessController>;
  customers: ReturnType<typeof createCustomerController>;
  products: ReturnType<typeof createProductController>;
}) {
  const r = Router();
  r.get('/business', c.business.get);
  r.put('/business', c.business.update);

  r.get('/customers', c.customers.list);
  r.post('/customers', c.customers.create);
  r.get('/customers/:id', c.customers.get);
  r.put('/customers/:id', c.customers.update);
  r.delete('/customers/:id', c.customers.remove);

  r.get('/products', c.products.list);
  r.post('/products', c.products.create);
  r.get('/products/:id', c.products.get);
  r.put('/products/:id', c.products.update);
  r.delete('/products/:id', c.products.remove);
  return r;
}
