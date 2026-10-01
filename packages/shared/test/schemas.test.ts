import {
  businessUpdateSchema,
  customerInputSchema,
  listQuerySchema,
  productInputSchema,
} from '../src';

describe('customerInputSchema', () => {
  it('normalises blanks to null and lowercases email', () => {
    const r = customerInputSchema.parse({ firstName: ' Ann ', lastName: '', email: ' ANN@X.CO ' });
    expect(r).toMatchObject({ firstName: 'Ann', lastName: null, email: 'ann@x.co', phone: null });
  });
  it('needs a name or company', () => {
    expect(customerInputSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
    expect(customerInputSchema.safeParse({ companyName: 'Acme' }).success).toBe(true);
  });
  it('strips unknown keys', () => {
    const r = customerInputSchema.parse({ firstName: 'A', businessId: 'x' }) as Record<
      string,
      unknown
    >;
    expect(r.businessId).toBeUndefined();
  });
});

describe('productInputSchema', () => {
  it('applies defaults', () => {
    expect(productInputSchema.parse({ name: 'X', priceMinor: 0 })).toMatchObject({
      unit: 'unit',
      taxRateBps: 0,
      isActive: true,
      sku: null,
    });
  });
  it.each([[-1], [1.5], ['5'], [2_000_000_000_000]])('rejects price %p', (priceMinor) => {
    expect(productInputSchema.safeParse({ name: 'X', priceMinor }).success).toBe(false);
  });
});

describe('businessUpdateSchema', () => {
  it('leaves omitted fields undefined and clears blank ones', () => {
    const r = businessUpdateSchema.parse({ phone: '' });
    expect(r.phone).toBeNull();
    expect('name' in r && r.name !== undefined).toBe(false);
    expect(r.city).toBeUndefined();
  });
  it('rejects unknown and read-only keys', () => {
    expect(businessUpdateSchema.safeParse({ stripeChargesEnabled: true }).success).toBe(false);
  });
  it('validates currency and discount-style bounds', () => {
    expect(businessUpdateSchema.safeParse({ defaultCurrency: 'EUR' }).success).toBe(true);
    expect(businessUpdateSchema.safeParse({ defaultCurrency: 'eur' }).success).toBe(false);
    expect(businessUpdateSchema.safeParse({ defaultPaymentTermsDays: 366 }).success).toBe(false);
  });
});

describe('listQuerySchema', () => {
  it('coerces and bounds', () => {
    expect(listQuerySchema.parse({ limit: '10', offset: '5' })).toMatchObject({
      limit: 10,
      offset: 5,
    });
    expect(listQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(listQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
