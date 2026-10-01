import { calculateInvoice } from '@invoiceflow/shared';
import { renderInvoicePdf, type PdfInput } from '../src/pdf/invoice-pdf';
import { pdfText, TINY_PNG } from './helpers';

function input(
  n: number,
  over: Partial<PdfInput['business']> = {},
  extra: Partial<PdfInput> = {},
): PdfInput {
  const items = Array.from({ length: n }, (_, i) => ({
    description:
      i % 4 === 0
        ? `Item ${i + 1}: ${'very long description with many words '.repeat(8)}`
        : `Item ${i + 1}`,
    quantityMilli: 1000 + i * 100,
    unitPriceMinor: 12_345,
    taxes: [{ name: 'GST', rateBps: 500 }],
  }));
  const t = calculateInvoice({ currency: 'USD', lines: items, feesMinor: 0 });
  return {
    invoice: {
      number: 'INV-0042',
      status: 'sent',
      displayStatus: 'sent',
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      taxInclusive: false,
      notes: 'Thanks for your business',
      terms: 'Net 14',
      subtotalMinor: t.subtotal,
      discountTotalMinor: 0,
      feesMinor: 0,
      totalMinor: t.total,
      amountPaidMinor: 0,
      balanceDueMinor: t.balanceDue,
      taxBreakdown: t.taxBreakdown,
      items: items.map((it, i) => ({ ...it, lineTotalMinor: t.lines[i]!.lineTotal })),
    },
    business: {
      name: 'Acme Studio',
      ownerName: 'Zoë Łukasz',
      email: 'b@acme.co',
      phone: null,
      addressLine1: '1 Main St',
      addressLine2: null,
      city: 'Austin',
      province: 'TX',
      postalCode: '78701',
      country: 'US',
      website: null,
      taxNumber: '99-123',
      paymentInstructions: 'Pay by bank transfer',
      accentColor: '#2563EB',
      template: 'classic',
      displayOptions: {},
      ...over,
    },
    customer: {
      name: 'John Smith',
      email: 'j@x.co',
      phone: null,
      addressLine1: '2 Side St',
      addressLine2: null,
      city: 'Dallas',
      province: 'TX',
      postalCode: '75001',
      country: 'USA',
    },
    ...extra,
  };
}

describe('renderInvoicePdf', () => {
  it('renders a valid PDF with all invoice content', async () => {
    const bytes = await renderInvoicePdf(input(3, {}, { payUrl: 'https://api.test/pay/abc' }));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const { text } = await pdfText(bytes);
    for (const s of [
      'INVOICE',
      'INV-0042',
      'Acme Studio',
      'John Smith',
      'October 1, 2026',
      'October 15, 2026',
      'Item 1',
      'Subtotal',
      'GST (5%)',
      'Total',
      'Balance due',
      'Thanks for your business',
      'Net 14',
      'Pay by bank transfer',
      'https://api.test/pay/abc',
      'Tax no: 99-123',
    ]) {
      expect(text).toContain(s);
    }
    // 1.0 x $123.45 = $123.45 line total; formatted with the currency symbol
    expect(text).toContain('$123.45');
  });

  it('flows long documents across pages, repeats the table header and numbers the pages', async () => {
    const { text, pages } = await pdfText(await renderInvoicePdf(input(70)));
    expect(pages).toBeGreaterThan(2);
    for (let i = 1; i <= 70; i++) expect(text).toContain(`Item ${i}`); // nothing dropped
    // The table header is repeated on every page that carries items (all but possibly the last).
    expect((text.match(/DESCRIPTION/g) ?? []).length).toBeGreaterThanOrEqual(pages - 1);
    expect(text).toContain(`Page 1 of ${pages}`);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // Totals appear once, on the last page
    expect((text.match(/Balance due/g) ?? []).length).toBe(1);
  });

  it('wraps very long descriptions without losing text', async () => {
    const long = 'word '.repeat(400).trim();
    const data = input(1);
    data.invoice.items[0]!.description = long;
    const { text } = await pdfText(await renderInvoicePdf(data));
    expect((text.match(/word/g) ?? []).length).toBeGreaterThanOrEqual(400);
  });

  it('renders accented and non-Latin-1 text and currency symbols', async () => {
    const data = input(1, { name: 'Café Łódź Ltd' });
    data.customer.name = 'Zoë Müller – Ðorđe';
    data.invoice.currency = 'INR';
    data.invoice.items[0]!.description = 'Zażółć gęślą jaźń — Привет';
    const { text } = await pdfText(await renderInvoicePdf(data));
    expect(text).toContain('Café Łódź Ltd');
    expect(text).toContain('Zoë Müller');
    expect(text).toContain('Zażółć gęślą jaźń');
    expect(text).toContain('Привет');
    expect(text).toContain('₹');
  });

  it('includes logo and signature images and tolerates broken ones', async () => {
    const plain = await renderInvoicePdf(input(2));
    const withImages = await renderInvoicePdf(
      input(2, {}, { logo: TINY_PNG, signature: TINY_PNG }),
    );
    expect(withImages.length).toBeGreaterThan(plain.length);
    const broken = await renderInvoicePdf(
      input(2, {}, { logo: Buffer.from('not an image'), signature: Buffer.from('nope') }),
    );
    expect((await pdfText(broken)).text).toContain('INV-0042');
  });

  it('shows status labels and omits the pay link when nothing is owed', async () => {
    const paid = input(1, {}, { payUrl: 'https://api.test/pay/zzz' });
    paid.invoice.status = 'paid';
    paid.invoice.displayStatus = 'paid';
    paid.invoice.balanceDueMinor = 0;
    const { text } = await pdfText(await renderInvoicePdf(paid));
    expect(text).toContain('PAID');
    expect(text).not.toContain('PAY ONLINE');
  });

  it('honours tax-inclusive labels, discounts, fees and hidden sections', async () => {
    const d = input(1, {
      displayOptions: { showNotes: false, showTerms: false, showTaxColumn: false },
    });
    d.invoice.taxInclusive = true;
    d.invoice.discountTotalMinor = 500;
    d.invoice.feesMinor = 250;
    const { text } = await pdfText(await renderInvoicePdf(d));
    expect(text).toContain('Subtotal (tax included)');
    expect(text).toContain('Discount');
    expect(text).toContain('Fees');
    expect(text).not.toContain('Thanks for your business');
    expect(text).not.toContain('TAX\n');
  });

  it('uses Letter for US/Canada and A4 elsewhere, in all templates', async () => {
    for (const template of ['classic', 'modern', 'minimal']) {
      const us = await renderInvoicePdf(input(1, { template, country: 'Canada' }));
      const de = await renderInvoicePdf(input(1, { template, country: 'Germany' }));
      expect(us.toString('latin1')).toMatch(/\/MediaBox \[0 0 612 792\]/);
      expect(de.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    }
  });
});
