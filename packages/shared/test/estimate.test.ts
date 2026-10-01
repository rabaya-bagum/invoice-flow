import {
  canConvertEstimate,
  canTransitionEstimate,
  defaultEstimateEmail,
  estimateDisplayStatus,
  estimateInputSchema,
  isEstimateEditable,
} from '../src';

describe('estimate status rules', () => {
  it('only moves forward', () => {
    expect(canTransitionEstimate('draft', 'sent')).toBe(true);
    expect(canTransitionEstimate('draft', 'accepted')).toBe(false);
    expect(canTransitionEstimate('sent', 'accepted')).toBe(true);
    expect(canTransitionEstimate('viewed', 'rejected')).toBe(true);
    expect(canTransitionEstimate('accepted', 'rejected')).toBe(false);
    expect(canTransitionEstimate('rejected', 'accepted')).toBe(false);
    expect(canTransitionEstimate('sent', 'sent')).toBe(false);
  });

  it('is editable until decided or converted', () => {
    for (const s of ['draft', 'sent', 'viewed'] as const) {
      expect(isEstimateEditable(s, false)).toBe(true);
      expect(isEstimateEditable(s, true)).toBe(false);
    }
    expect(isEstimateEditable('accepted', false)).toBe(false);
    expect(isEstimateEditable('rejected', false)).toBe(false);
  });

  it('converts once, unless declined', () => {
    expect(canConvertEstimate('draft', false)).toBe(true);
    expect(canConvertEstimate('accepted', false)).toBe(true);
    expect(canConvertEstimate('rejected', false)).toBe(false);
    expect(canConvertEstimate('accepted', true)).toBe(false);
  });

  it('derives "expired" only for open estimates past their expiry date', () => {
    const today = '2026-10-15';
    expect(estimateDisplayStatus({ status: 'sent', expiryDate: '2026-10-14' }, today)).toBe(
      'expired',
    );
    expect(estimateDisplayStatus({ status: 'viewed', expiryDate: '2026-10-14' }, today)).toBe(
      'expired',
    );
    expect(estimateDisplayStatus({ status: 'sent', expiryDate: '2026-10-15' }, today)).toBe('sent');
    expect(estimateDisplayStatus({ status: 'accepted', expiryDate: '2026-01-01' }, today)).toBe(
      'accepted',
    );
    expect(estimateDisplayStatus({ status: 'draft', expiryDate: '2026-01-01' }, today)).toBe(
      'draft',
    );
  });
});

describe('estimate input', () => {
  const base = {
    customerId: '11111111-1111-4111-8111-111111111111',
    issueDate: '2026-10-01',
    expiryDate: '2026-10-31',
    currency: 'USD',
    items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 100, taxes: [] }],
  };

  it('requires an expiry date and rejects invalid ones', () => {
    expect(estimateInputSchema.safeParse(base).success).toBe(true);
    expect(estimateInputSchema.safeParse({ ...base, expiryDate: undefined }).success).toBe(false);
    expect(estimateInputSchema.safeParse({ ...base, expiryDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('does not accept a due date and strips unknown fields', () => {
    const parsed = estimateInputSchema.parse({
      ...base,
      dueDate: '2026-10-05',
      status: 'accepted',
    });
    expect(parsed).not.toHaveProperty('dueDate');
    expect(parsed).not.toHaveProperty('status');
  });
});

describe('default estimate email', () => {
  it('mentions the number, total and validity', () => {
    const m = defaultEstimateEmail({
      businessName: 'Acme',
      customerName: 'Ann',
      estimateNumber: 'EST-0001',
      totalMinor: 105_000,
      currency: 'USD',
      expiryDate: '2026-10-31',
    });
    expect(m.subject).toBe('Estimate EST-0001 from Acme');
    expect(m.message).toContain('estimate EST-0001 for $1,050.00');
    expect(m.message).toContain('valid until October 31, 2026');
  });
});
