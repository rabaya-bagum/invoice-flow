import {
  type BusinessUpdate,
  type CustomerInput,
  type ListQuery,
  type ProductInput,
} from '@invoiceflow/shared';
import type { BusinessRepository } from '../repositories/business-repository';
import type { CustomerRepository } from '../repositories/customer-repository';
import { isUniqueViolation, type ProductRepository } from '../repositories/product-repository';
import { AppError, notFound } from '../utils/errors';

export function createBusinessService(repo: BusinessRepository) {
  return {
    async get(businessId: string) {
      return (await repo.get(businessId)) ?? Promise.reject(notFound('Business'));
    },
    async update(businessId: string, patch: BusinessUpdate) {
      return (await repo.update(businessId, patch)) ?? Promise.reject(notFound('Business'));
    },
  };
}
export type BusinessService = ReturnType<typeof createBusinessService>;

export function createCustomerService(repo: CustomerRepository) {
  return {
    list: (businessId: string, q: ListQuery) => repo.list(businessId, q),
    async get(businessId: string, id: string) {
      return (await repo.get(businessId, id)) ?? Promise.reject(notFound('Customer'));
    },
    create: (businessId: string, input: CustomerInput) => repo.create(businessId, input),
    async update(businessId: string, id: string, input: CustomerInput) {
      return (await repo.update(businessId, id, input)) ?? Promise.reject(notFound('Customer'));
    },
    async remove(businessId: string, id: string) {
      if (!(await repo.softDelete(businessId, id))) throw notFound('Customer');
    },
  };
}
export type CustomerService = ReturnType<typeof createCustomerService>;

export function createProductService(repo: ProductRepository) {
  const skuTaken = () => new AppError(409, 'SKU_EXISTS', 'Another product already uses that SKU');
  return {
    list: (businessId: string, q: Parameters<ProductRepository['list']>[1]) =>
      repo.list(businessId, q),
    async get(businessId: string, id: string) {
      return (await repo.get(businessId, id)) ?? Promise.reject(notFound('Product'));
    },
    async create(businessId: string, input: ProductInput) {
      try {
        return await repo.create(businessId, input);
      } catch (e) {
        throw isUniqueViolation(e) ? skuTaken() : e;
      }
    },
    async update(businessId: string, id: string, input: ProductInput) {
      try {
        return (await repo.update(businessId, id, input)) ?? Promise.reject(notFound('Product'));
      } catch (e) {
        throw isUniqueViolation(e) ? skuTaken() : e;
      }
    },
    async remove(businessId: string, id: string) {
      if (!(await repo.delete(businessId, id))) throw notFound('Product');
    },
  };
}
export type ProductService = ReturnType<typeof createProductService>;
