import path from 'node:path';
import {
  buildTotalsRows,
  formatLongDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  isSupportedCurrency,
} from '@invoiceflow/shared';
import PDFDocument from 'pdfkit';

export interface PdfInput {
  invoice: {
    number: string;
    status: string;
    displayStatus: string;
    issueDate: string;
    dueDate: string;
    currency: string;
    taxInclusive: boolean;
    notes: string | null;
    terms: string | null;
    subtotalMinor: number;
    discountTotalMinor: number;
    feesMinor: number;
    totalMinor: number;
    amountPaidMinor: number;
    balanceDueMinor: number;
    taxBreakdown: Array<{ name: string; rateBps: number; tax: number }>;
    items: Array<{
      description: string;
      quantityMilli: number;
      unitPriceMinor: number;
      taxes: Array<{ name: string; rateBps: number }>;
      lineTotalMinor: number;
    }>;
  };
  business: {
    name: string;
    ownerName: string | null;
    email: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
    website: string | null;
    taxNumber: string | null;
    paymentInstructions: string | null;
    accentColor: string;
    template: string;
    displayOptions: Record<string, boolean>;
  };
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
  };
  logo?: Buffer | null;
  signature?: Buffer | null;
  /** Public pay-page URL, printed (and clickable) while a balance is outstanding. */
  payUrl?: string | null;
  /** An estimate prints "ESTIMATE" and "Valid until", with no payment rows. `dueDate` carries the expiry. */
  kind?: 'invoice' | 'estimate';
}

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const MARGIN = 48;
const BOTTOM = 64; // bottom margin: leaves room for the footer
const INK = '#0F172A';
const MUTED = '#64748B';
const RULE = '#E2E8F0';

const hex = (c: string) =>
  [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
/** Mix a colour with white (amount 0..1 of colour). */
const tint = (c: string, amount: number) => {
  const [r, g, b] = hex(/^#[0-9a-f]{6}$/i.test(c) ? c : '#2563EB');
  const mix = (v: number) => Math.round(255 - (255 - v) * amount);
  return `#${[r, g, b].map((v) => mix(v).toString(16).padStart(2, '0')).join('')}`;
};

const money = (n: number, cur: string) =>
  isSupportedCurrency(cur) ? formatMoney(n, cur) : `${n} ${cur}`;
const lines = (...v: Array<string | null | undefined>) =>
  v.filter((x): x is string => !!x && x.trim() !== '');

const addressLines = (a: PdfInput['customer']) =>
  lines(
    a.addressLine1,
    a.addressLine2,
    lines(a.city, a.province, a.postalCode).join(', '),
    a.country,
  );

const usesLetter = (country: string | null) =>
  !!country && /^(us|usa|united states|ca|canada)$/i.test(country.trim());

const STATUS_LABEL: Record<string, string> = {
  paid: 'PAID',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  overdue: 'OVERDUE',
  partially_paid: 'PARTIALLY PAID',
  accepted: 'ACCEPTED',
  rejected: 'DECLINED',
  expired: 'EXPIRED',
};

/** Renders a multi-page, Unicode-capable invoice PDF. */
export function renderInvoicePdf(input: PdfInput): Promise<Buffer> {
  const { invoice: inv, business: biz, customer, payUrl } = input;
  const isEstimate = input.kind === 'estimate';
  const docName = isEstimate ? 'Estimate' : 'Invoice';
  const accent = /^#[0-9a-f]{6}$/i.test(biz.accentColor) ? biz.accentColor : '#2563EB';
  const opt = (k: string) => biz.displayOptions[k] !== false; // everything shown unless switched off
  const modern = biz.template === 'modern';
  const minimal = biz.template === 'minimal';

  const doc = new PDFDocument({
    size: usesLetter(biz.country) ? 'LETTER' : 'A4',
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: BOTTOM },
    bufferPages: true,
    info: { Title: `${docName} ${inv.number}`, Author: biz.name, Producer: 'InvoiceFlow' },
  });
  doc.registerFont('R', path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('B', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width - MARGIN * 2;
  const limit = () => doc.page.height - BOTTOM;
  const ensure = (h: number, onNewPage?: () => void) => {
    if (doc.y + h > limit()) {
      doc.addPage();
      doc.y = MARGIN;
      onNewPage?.();
    }
  };
  const text = (
    s: string,
    x: number,
    y: number,
    o: PDFKit.Mixins.TextOptions & { font?: 'R' | 'B'; size?: number; color?: string } = {},
  ) => {
    const { font = 'R', size = 10, color = INK, ...rest } = o;
    doc.font(font).fontSize(size).fillColor(color).text(s, x, y, rest);
  };

  // ------------------------------------------------------------------ header
  const top = MARGIN;
  const bizLines = lines(
    biz.addressLine1,
    biz.addressLine2,
    lines(biz.city, biz.province, biz.postalCode).join(', '),
    biz.country,
    biz.phone,
    biz.email,
    biz.website,
    biz.taxNumber ? `Tax no: ${biz.taxNumber}` : null,
  );
  const hasLogo = !!input.logo && opt('showLogo');
  if (modern) {
    // The coloured band must cover the whole header, so measure the left column first.
    doc.font('B').fontSize(14);
    let h = (hasLogo ? 62 : 0) + doc.heightOfString(biz.name, { width: W * 0.55 }) + 2;
    doc.font('R').fontSize(9);
    for (const l of bizLines) h += doc.heightOfString(l, { width: W * 0.55 });
    doc.rect(0, 0, doc.page.width, top + Math.max(h, 104) + 14).fill(accent);
  }
  const headFg = modern ? '#FFFFFF' : INK;
  const headMuted = modern ? '#E2E8F0' : MUTED;

  let leftY = top;
  if (hasLogo && input.logo) {
    try {
      doc.image(input.logo, MARGIN, top, { fit: [150, 56] });
      leftY = top + 62;
    } catch {
      /* unreadable image: skip the logo rather than fail the whole document */
    }
  }
  text(biz.name, MARGIN, leftY, { font: 'B', size: 14, color: headFg, width: W * 0.55 });
  leftY = doc.y + 2;
  for (const l of bizLines) {
    text(l, MARGIN, leftY, { size: 9, color: headMuted, width: W * 0.55 });
    leftY = doc.y;
  }

  const rx = MARGIN + W * 0.58;
  const rw = W * 0.42;
  text(docName.toUpperCase(), rx, top, {
    font: 'B',
    size: 24,
    color: modern ? '#FFFFFF' : accent,
    width: rw,
    align: 'right',
  });
  let rightY = doc.y + 6;
  const meta: Array<[string, string]> = [
    [`${docName} no.`, inv.number],
    ['Issue date', formatLongDate(inv.issueDate)],
    [isEstimate ? 'Valid until' : 'Due date', formatLongDate(inv.dueDate)],
  ];
  for (const [k, v] of meta) {
    text(k, rx, rightY, { size: 9, color: headMuted, width: rw * 0.4 });
    text(v, rx + rw * 0.4, rightY, {
      size: 10,
      font: 'B',
      color: headFg,
      width: rw * 0.6,
      align: 'right',
    });
    rightY = Math.max(doc.y, rightY + 14) + 2;
  }
  const label = STATUS_LABEL[inv.displayStatus];
  if (label) {
    text(label, rx, rightY + 2, {
      font: 'B',
      size: 11,
      color: modern ? '#FFFFFF' : inv.displayStatus === 'paid' ? '#15803D' : '#DC2626',
      width: rw,
      align: 'right',
    });
    rightY = doc.y;
  }

  doc.y = Math.max(leftY, rightY) + (modern ? 34 : 22);

  // ------------------------------------------------------------------ bill to
  text('BILL TO', MARGIN, doc.y, { font: 'B', size: 8, color: MUTED });
  text(customer.name, MARGIN, doc.y + 2, { font: 'B', size: 11, width: W * 0.5 });
  for (const l of lines(...addressLines(customer), customer.email, customer.phone)) {
    text(l, MARGIN, doc.y, { size: 9, color: MUTED, width: W * 0.5 });
  }
  doc.y += 22;

  // ------------------------------------------------------------------ items table
  const col = { qty: 52, price: 82, tax: 84, amount: 88 };
  const descW = W - col.qty - col.price - col.tax - col.amount;
  const x = {
    desc: MARGIN,
    qty: MARGIN + descW,
    price: MARGIN + descW + col.qty,
    tax: MARGIN + descW + col.qty + col.price,
    amount: MARGIN + descW + col.qty + col.price + col.tax,
  };
  const showTax = opt('showTaxColumn');
  const drawHead = () => {
    const y = doc.y;
    if (!minimal) doc.rect(MARGIN, y, W, 22).fill(tint(accent, 0.12));
    else
      doc
        .moveTo(MARGIN, y + 22)
        .lineTo(MARGIN + W, y + 22)
        .lineWidth(1)
        .strokeColor(INK)
        .stroke();
    const h = (s: string, px: number, w: number, align: 'left' | 'right') =>
      text(s, px + 6, y + 7, {
        font: 'B',
        size: 8,
        color: minimal ? INK : accent,
        width: w - 12,
        align,
        lineBreak: false,
      });
    h('DESCRIPTION', x.desc, descW, 'left');
    h('QTY', x.qty, col.qty, 'right');
    h('PRICE', x.price, col.price, 'right');
    if (showTax) h('TAX', x.tax, col.tax, 'left');
    h('AMOUNT', showTax ? x.amount : x.tax, showTax ? col.amount : col.tax + col.amount, 'right');
    doc.y = y + 22;
  };
  drawHead();

  for (const it of inv.items) {
    const taxText = it.taxes.length
      ? it.taxes.map((t) => `${t.name} ${formatPercent(t.rateBps)}%`).join('\n')
      : '–';
    doc.font('R').fontSize(10);
    const dh = doc.heightOfString(it.description, { width: descW - 12 });
    doc.fontSize(9);
    const th = showTax ? doc.heightOfString(taxText, { width: col.tax - 12 }) : 0;
    const rowH = Math.max(dh, th, 14) + 14;
    ensure(rowH, drawHead);
    const y = doc.y;
    text(it.description, x.desc + 6, y + 7, { size: 10, width: descW - 12 });
    text(formatQuantity(it.quantityMilli), x.qty + 6, y + 7, {
      size: 10,
      width: col.qty - 12,
      align: 'right',
      lineBreak: false,
    });
    text(money(it.unitPriceMinor, inv.currency), x.price + 6, y + 7, {
      size: 10,
      width: col.price - 12,
      align: 'right',
      lineBreak: false,
    });
    if (showTax) text(taxText, x.tax + 6, y + 8, { size: 9, color: MUTED, width: col.tax - 12 });
    const aw = showTax ? col.amount : col.tax + col.amount;
    text(money(it.lineTotalMinor, inv.currency), showTax ? x.amount + 6 : x.tax + 6, y + 7, {
      size: 10,
      font: 'B',
      width: aw - 12,
      align: 'right',
      lineBreak: false,
    });
    doc
      .moveTo(MARGIN, y + rowH)
      .lineTo(MARGIN + W, y + rowH)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.y = y + rowH;
  }

  // ------------------------------------------------------------------ totals
  const allRows = buildTotalsRows({
    currency: inv.currency,
    taxInclusive: inv.taxInclusive,
    subtotal: inv.subtotalMinor,
    discountTotal: inv.discountTotalMinor,
    taxBreakdown: inv.taxBreakdown,
    fees: inv.feesMinor,
    total: inv.totalMinor,
    amountPaid: inv.amountPaidMinor,
    balanceDue: inv.balanceDueMinor,
  });
  // An estimate has nothing paid or owing yet: its Total is the headline row.
  const rows = isEstimate
    ? allRows.filter((r) => r.label !== 'Amount paid' && r.label !== 'Balance due')
    : allRows;
  const headline = isEstimate ? 'Total' : 'Balance due';
  const tw = 236;
  ensure(rows.length * 20 + 24);
  doc.y += 14;
  for (const r of rows) {
    const y = doc.y;
    if (r.strong && r.label === headline) {
      doc.rect(MARGIN + W - tw - 8, y - 4, tw + 8, 24).fill(tint(accent, 0.12));
    }
    text(r.label, MARGIN + W - tw, y + 1, {
      size: r.strong ? 11 : 10,
      font: r.strong ? 'B' : 'R',
      color: r.strong ? INK : MUTED,
      width: tw * 0.55,
      lineBreak: false,
    });
    text(r.value, MARGIN + W - tw * 0.45, y + 1, {
      size: r.strong ? 11 : 10,
      font: r.strong ? 'B' : 'R',
      width: tw * 0.45 - 8,
      align: 'right',
      lineBreak: false,
    });
    doc.y = y + 20;
  }

  // ------------------------------------------------------------------ payment, notes, terms
  const owing =
    !isEstimate &&
    inv.balanceDueMinor > 0 &&
    ['sent', 'viewed', 'partially_paid'].includes(inv.status);
  const section = (title: string, body: string, link?: string) => {
    ensure(48);
    doc.y += 14;
    text(title, MARGIN, doc.y, { font: 'B', size: 9, color: accent });
    doc
      .font('R')
      .fontSize(10)
      .fillColor(INK)
      .text(body, MARGIN, doc.y + 3, { width: W, link, underline: !!link });
  };
  if (opt('showPaymentInfo') && !isEstimate) {
    if (owing && payUrl) section('PAY ONLINE', payUrl, payUrl);
    if (biz.paymentInstructions) section('PAYMENT INFORMATION', biz.paymentInstructions);
  }
  if (inv.notes && opt('showNotes')) section('NOTES', inv.notes);
  if (inv.terms && opt('showTerms')) section('TERMS AND CONDITIONS', inv.terms);

  if (input.signature && opt('showSignature')) {
    ensure(92);
    doc.y += 22;
    const y = doc.y;
    try {
      doc.image(input.signature, MARGIN, y, { fit: [150, 50] });
    } catch {
      /* skip unreadable signature */
    }
    doc
      .moveTo(MARGIN, y + 56)
      .lineTo(MARGIN + 170, y + 56)
      .lineWidth(0.75)
      .strokeColor(MUTED)
      .stroke();
    text(
      biz.ownerName ? `${biz.ownerName} · Authorized signature` : 'Authorized signature',
      MARGIN,
      y + 60,
      { size: 8, color: MUTED, width: 240 },
    );
  }

  // ------------------------------------------------------------------ footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const m = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not trigger a new page
    const y = doc.page.height - 36;
    text(`${biz.name} · ${docName} ${inv.number}`, MARGIN, y, {
      size: 8,
      color: MUTED,
      width: W / 2,
      lineBreak: false,
    });
    text(`Page ${i + 1} of ${range.count}`, MARGIN + W / 2, y, {
      size: 8,
      color: MUTED,
      width: W / 2,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = m;
  }

  doc.end();
  return finished;
}
