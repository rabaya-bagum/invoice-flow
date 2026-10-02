import {
  buildTotalsRows,
  formatLongDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  getExponent,
  isSupportedCurrency,
} from '@invoiceflow/shared';
import { escapeHtml as e } from '../services/email';
import { pageBranding, TEMPLATE_CSS } from './branding';
import { PAY_CLIENT_JS } from './pay-client';
import type { LoadedDocument } from '../services/document-service';

type View = LoadedDocument & { payable: boolean };

/** Stripe.js-based online payment, shown only when the business can take card payments. */
export interface PayPageStripe {
  publishableKey: string;
}

/** CSP for the page: strict by default; Stripe hosts are allowed only when online payment is on. */
export function payPageCsp(nonce: string, stripeEnabled: boolean): string {
  const base = [
    "default-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ];
  if (!stripeEnabled) {
    return [
      ...base,
      "style-src 'unsafe-inline'",
      'img-src data:',
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
    ].join('; ');
  }
  return [
    ...base,
    "style-src 'unsafe-inline'",
    'img-src data: https://*.stripe.com',
    `script-src 'nonce-${nonce}' https://js.stripe.com`,
    "connect-src 'self' https://api.stripe.com https://*.stripe.com",
    'frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com',
  ].join('; ');
}

/** JSON for a <script type="application/json"> block: `<` is escaped so content can never close the tag. */
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const money = (n: number, cur: string) =>
  isSupportedCurrency(cur) ? formatMoney(n, cur) : `${n} ${cur}`;
const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#2563EB');
const STATUS: Record<string, string> = {
  sent: 'Awaiting payment',
  viewed: 'Awaiting payment',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

/**
 * Server-rendered customer-facing invoice page. Every dynamic value is HTML-escaped, there is no
 * inline event handler, and the single script is allowed by nonce under a strict CSP.
 */
export function renderPayPage(
  view: View,
  opts: {
    token: string;
    nonce: string;
    logoDataUri?: string | null;
    stripe?: PayPageStripe | null;
  },
): string {
  const { invoice: inv, business: biz, customer } = view;
  const accent = safeColor(biz.accentColor);
  const brand = pageBranding(biz);
  const rows = buildTotalsRows({
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
  const bizAddress = [
    biz.addressLine1,
    biz.addressLine2,
    [biz.city, biz.province, biz.postalCode].filter(Boolean).join(', '),
    biz.country,
  ]
    .filter(Boolean)
    .map((l) => e(l as string))
    .join('<br>');
  const custAddress = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.city, customer.province, customer.postalCode].filter(Boolean).join(', '),
    customer.country,
  ]
    .filter(Boolean)
    .map((l) => e(l as string))
    .join('<br>');
  const items = inv.items
    .map(
      (it) => `
    <tr>
      <td class="desc">${e(it.description)}${it.taxes.length && brand.on('showTaxColumn') ? `<div class="muted small">${it.taxes.map((t) => `${e(t.name)} ${formatPercent(t.rateBps)}%`).join(', ')}</div>` : ''}</td>
      <td class="num">${formatQuantity(it.quantityMilli)}</td>
      <td class="num">${e(money(it.unitPriceMinor, inv.currency))}</td>
      <td class="num strong">${e(money(it.lineTotalMinor, inv.currency))}</td>
    </tr>`,
    )
    .join('');
  const totals = rows
    .map(
      (r) =>
        `<div class="trow${r.strong ? ' strong' : ''}"><span>${e(r.label)}</span><span>${e(r.value)}</span></div>`,
    )
    .join('');
  const statusLabel = STATUS[inv.displayStatus] ?? inv.displayStatus;

  const stripe = view.payable ? opts.stripe : null;
  const other =
    biz.paymentInstructions && brand.on('showPaymentInfo')
      ? `<h3>Other ways to pay</h3><p class="pre">${e(biz.paymentInstructions)}</p>`
      : '';
  const pay = view.payable
    ? stripe
      ? `<section class="card" id="pay-section"><h2>Pay this invoice</h2>
        <p class="muted">Amount due: <strong>${e(money(inv.balanceDueMinor, inv.currency))}</strong></p>
        <div id="pay-msg" hidden role="status" aria-live="polite"></div>
        <div id="pay-choose">
          <label class="opt"><input type="radio" name="pay-mode" id="pay-mode-full" checked> Pay the full amount (${e(money(inv.balanceDueMinor, inv.currency))})</label>
          <label class="opt"><input type="radio" name="pay-mode" id="pay-mode-partial"> Pay a different amount</label>
          <div id="pay-amount-row" hidden><label for="pay-amount">Amount (${e(inv.currency)})</label><input id="pay-amount" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
          <button type="button" id="pay-start" class="primary">Continue to payment</button>
        </div>
        <form id="pay-form" hidden><div id="payment-element"></div><button type="submit" id="pay-submit" class="primary">Pay</button></form>
        ${other}
      </section>`
      : `<section class="card"><h2>How to pay</h2>
        ${biz.paymentInstructions && brand.on('showPaymentInfo') ? `<p class="pre">${e(biz.paymentInstructions)}</p>` : '<p class="muted">Online payment is not available for this invoice. Please contact the sender to arrange payment.</p>'}
      </section>`
    : '';
  const stripeScripts = stripe
    ? `<script type="application/json" id="pay-config">${jsonForScript({
        token: opts.token,
        publishableKey: stripe.publishableKey,
        accent,
        exponent: isSupportedCurrency(inv.currency) ? getExponent(inv.currency) : 2,
        balanceMinor: inv.balanceDueMinor,
        paidMinor: inv.amountPaidMinor,
      })}</script>
<script src="https://js.stripe.com/v3/"></script>
<script nonce="${e(opts.nonce)}">${PAY_CLIENT_JS}</script>`
    : '';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>Invoice ${e(inv.number)} from ${e(biz.name)}</title>
<style>
:root{--accent:${accent};--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f5f7fa}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:760px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:16px;padding:20px;margin:0 0 16px}
header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{margin:0;font-size:1.4rem;color:var(--accent)}h2{margin:0 0 8px;font-size:1.1rem}h3{font-size:1rem;margin:16px 0 4px}
.logo{max-height:56px;max-width:180px;display:block;margin-bottom:8px}.muted{color:var(--muted)}.small{font-size:.8rem}.strong{font-weight:700}.pre{white-space:pre-wrap}
.badge{display:inline-block;border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:2px 12px;font-weight:700;font-size:.85rem}
table{width:100%;border-collapse:collapse;margin-top:8px}th{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);text-align:right;padding:8px 6px;border-bottom:1px solid var(--line)}
th:first-child,td.desc{text-align:left}td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:top}td.num{text-align:right;white-space:nowrap}
.totals{margin-left:auto;max-width:320px;margin-top:12px}.trow{display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)}.trow.strong{color:var(--ink);font-weight:700}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:560px){.grid{grid-template-columns:1fr}}
button.primary{min-height:48px;width:100%;border:0;border-radius:12px;background:var(--accent);color:#fff;font-size:1rem;font-weight:700;margin-top:12px}button:disabled{opacity:.55}
.opt{display:block;padding:8px 0}#pay-amount-row{margin:4px 0 8px}#pay-amount{width:100%;min-height:44px;font-size:1rem;padding:0 12px;border:1px solid var(--line);border-radius:10px}
#pay-msg{padding:10px 12px;border-radius:10px;margin:8px 0;background:#eff6ff}#pay-msg.error{background:#fef2f2;color:#991b1b}#pay-msg.ok{background:#f0fdf4;color:#166534}
a.btn{display:inline-block;min-height:44px;line-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:12px;color:var(--ink);text-decoration:none;font-weight:600}
${TEMPLATE_CSS}</style></head>
<body class="t-${brand.template}" data-token="${e(opts.token)}"><main>
<section class="card head"><header>
  <div>${opts.logoDataUri && brand.on('showLogo') ? `<img class="logo" alt="" src="${e(opts.logoDataUri)}">` : ''}<strong>${e(biz.name)}</strong>
    <div class="muted small">${bizAddress}${biz.email ? `<br>${e(biz.email)}` : ''}${biz.phone ? `<br>${e(biz.phone)}` : ''}${biz.website ? `<br>${e(biz.website)}` : ''}${biz.taxNumber ? `<br>Tax no: ${e(biz.taxNumber)}` : ''}</div></div>
  <div style="text-align:right"><h1>Invoice ${e(inv.number)}</h1><span class="badge">${e(statusLabel)}</span>
    <div class="muted small">Issued ${e(formatLongDate(inv.issueDate))}<br>Due ${e(formatLongDate(inv.dueDate))}</div></div>
</header></section>
<section class="card grid"><div><h2>Bill to</h2><strong>${e(customer.name)}</strong><div class="muted small">${custAddress}</div></div>
  <div><h2>Amount due</h2><div class="strong" style="font-size:1.6rem">${e(money(inv.balanceDueMinor, inv.currency))}</div></div></section>
<section class="card"><table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table>
  <div class="totals">${totals}</div></section>
${pay}
${inv.notes && brand.on('showNotes') ? `<section class="card"><h2>Notes</h2><p class="pre">${e(inv.notes)}</p></section>` : ''}
${inv.terms && brand.on('showTerms') ? `<section class="card"><h2>Terms and conditions</h2><p class="pre muted">${e(inv.terms)}</p></section>` : ''}
<p><a class="btn" href="/public/invoices/${e(opts.token)}/pdf" download>Download PDF</a></p>
</main>
${stripeScripts}
<script nonce="${e(opts.nonce)}">fetch('/public/invoices/'+encodeURIComponent(document.body.dataset.token)+'/view',{method:'POST',keepalive:true}).catch(function(){});</script>
</body></html>`;
}
