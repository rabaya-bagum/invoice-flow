import {
  buildTotalsRows,
  formatLongDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  isSupportedCurrency,
} from '@invoiceflow/shared';
import { escapeHtml as e } from '../services/email';
import type { LoadedDocument } from '../services/document-service';

type View = LoadedDocument & { payable: boolean };

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
  opts: { token: string; nonce: string; logoDataUri?: string | null },
): string {
  const { invoice: inv, business: biz, customer } = view;
  const accent = safeColor(biz.accentColor);
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
      <td class="desc">${e(it.description)}${it.taxes.length ? `<div class="muted small">${it.taxes.map((t) => `${e(t.name)} ${formatPercent(t.rateBps)}%`).join(', ')}</div>` : ''}</td>
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

  const pay = view.payable
    ? `<section class="card"><h2>Pay this invoice</h2>
        <p class="muted">Amount due: <strong>${e(money(inv.balanceDueMinor, inv.currency))}</strong></p>
        <button type="button" disabled aria-disabled="true">Online payment is not available yet</button>
        ${biz.paymentInstructions ? `<h3>Other ways to pay</h3><p class="pre">${e(biz.paymentInstructions)}</p>` : ''}
      </section>`
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
button{min-height:48px;width:100%;border:0;border-radius:12px;background:var(--accent);color:#fff;font-size:1rem;font-weight:700;opacity:.55}
a.btn{display:inline-block;min-height:44px;line-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:12px;color:var(--ink);text-decoration:none;font-weight:600}
</style></head>
<body data-token="${e(opts.token)}"><main>
<section class="card"><header>
  <div>${opts.logoDataUri ? `<img class="logo" alt="" src="${e(opts.logoDataUri)}">` : ''}<strong>${e(biz.name)}</strong>
    <div class="muted small">${bizAddress}${biz.email ? `<br>${e(biz.email)}` : ''}${biz.phone ? `<br>${e(biz.phone)}` : ''}${biz.website ? `<br>${e(biz.website)}` : ''}${biz.taxNumber ? `<br>Tax no: ${e(biz.taxNumber)}` : ''}</div></div>
  <div style="text-align:right"><h1>Invoice ${e(inv.number)}</h1><span class="badge">${e(statusLabel)}</span>
    <div class="muted small">Issued ${e(formatLongDate(inv.issueDate))}<br>Due ${e(formatLongDate(inv.dueDate))}</div></div>
</header></section>
<section class="card grid"><div><h2>Bill to</h2><strong>${e(customer.name)}</strong><div class="muted small">${custAddress}</div></div>
  <div><h2>Amount due</h2><div class="strong" style="font-size:1.6rem">${e(money(inv.balanceDueMinor, inv.currency))}</div></div></section>
<section class="card"><table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table>
  <div class="totals">${totals}</div></section>
${pay}
${inv.notes ? `<section class="card"><h2>Notes</h2><p class="pre">${e(inv.notes)}</p></section>` : ''}
${inv.terms ? `<section class="card"><h2>Terms and conditions</h2><p class="pre muted">${e(inv.terms)}</p></section>` : ''}
<p><a class="btn" href="/public/invoices/${e(opts.token)}/pdf" download>Download PDF</a></p>
</main>
<script nonce="${e(opts.nonce)}">fetch('/public/invoices/'+encodeURIComponent(document.body.dataset.token)+'/view',{method:'POST',keepalive:true}).catch(function(){});</script>
</body></html>`;
}
