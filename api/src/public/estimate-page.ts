import {
  buildTotalsRows,
  formatLongDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  isSupportedCurrency,
} from '@invoiceflow/shared';
import { escapeHtml as e } from '../services/email';
import type { DocumentService } from '../services/document-service';

type View = NonNullable<Awaited<ReturnType<DocumentService['estimatePublicView']>>>;

const money = (n: number, cur: string) =>
  isSupportedCurrency(cur) ? formatMoney(n, cur) : `${n} ${cur}`;
const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#2563EB');
const STATUS: Record<string, string> = {
  sent: 'Awaiting your response',
  viewed: 'Awaiting your response',
  accepted: 'Accepted',
  rejected: 'Declined',
  expired: 'Expired',
};

/** The browser script: records the view, and sends the customer's answer. No dynamic code. */
const CLIENT_JS = String.raw`
(function () {
  var token = document.body.dataset.token;
  var base = '/public/estimates/' + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  fetch(base + '/view', { method: 'POST', keepalive: true }).catch(function () {});
  var ERRORS = {
    ALREADY_DECIDED: 'This estimate was already answered. Please contact the sender to change it.',
    ESTIMATE_EXPIRED: 'This estimate has expired. Please contact the sender.',
    ALREADY_CONVERTED: 'This estimate has already been turned into an invoice.',
    RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.'
  };
  function say(text, kind) {
    var el = $('respond-msg');
    el.textContent = text || '';
    el.className = kind || '';
    el.hidden = !text;
  }
  async function respond(decision) {
    say('');
    var buttons = document.querySelectorAll('.respond-btn');
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var res = await fetch(base + '/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: decision, name: $('respond-name').value })
      });
      if (res.ok) { window.location.reload(); return; }
      var code = '';
      try { code = (await res.json()).error.code; } catch (e) {}
      say(ERRORS[code] || 'Something went wrong. Please try again.', 'error');
    } catch (e) {
      say('Could not reach the server. Please check your connection and try again.', 'error');
    }
    buttons.forEach(function (b) { b.disabled = false; });
  }
  var accept = $('accept-btn'), decline = $('decline-btn');
  if (accept) accept.addEventListener('click', function () { respond('accept'); });
  if (decline) decline.addEventListener('click', function () {
    if (window.confirm('Decline this estimate?')) respond('decline');
  });
})();
`;

/** Server-rendered customer-facing estimate page. Every dynamic value is HTML-escaped. */
export function renderEstimatePage(
  view: View,
  opts: { token: string; nonce: string; logoDataUri?: string | null },
): string {
  const { estimate: est, business: biz, customer } = view;
  const accent = safeColor(biz.accentColor);
  const rows = buildTotalsRows({
    currency: est.currency,
    taxInclusive: est.taxInclusive,
    subtotal: est.subtotalMinor,
    discountTotal: est.discountTotalMinor,
    taxBreakdown: est.taxBreakdown,
    fees: est.feesMinor,
    total: est.totalMinor,
    amountPaid: 0,
    balanceDue: est.totalMinor,
  }).filter((r) => r.label !== 'Amount paid' && r.label !== 'Balance due');
  const lines = (...v: Array<string | null | undefined>) =>
    v
      .filter(Boolean)
      .map((l) => e(l as string))
      .join('<br>');
  const bizAddress = lines(
    biz.addressLine1,
    biz.addressLine2,
    [biz.city, biz.province, biz.postalCode].filter(Boolean).join(', '),
    biz.country,
  );
  const custAddress = lines(
    customer.addressLine1,
    customer.addressLine2,
    [customer.city, customer.province, customer.postalCode].filter(Boolean).join(', '),
    customer.country,
  );
  const items = est.items
    .map(
      (it) => `
    <tr>
      <td class="desc">${e(it.description)}${it.taxes.length ? `<div class="muted small">${it.taxes.map((t) => `${e(t.name)} ${formatPercent(t.rateBps)}%`).join(', ')}</div>` : ''}</td>
      <td class="num">${formatQuantity(it.quantityMilli)}</td>
      <td class="num">${e(money(it.unitPriceMinor, est.currency))}</td>
      <td class="num strong">${e(money(it.lineTotalMinor, est.currency))}</td>
    </tr>`,
    )
    .join('');
  const totals = rows
    .map(
      (r) =>
        `<div class="trow${r.strong ? ' strong' : ''}"><span>${e(r.label)}</span><span>${e(r.value)}</span></div>`,
    )
    .join('');

  let decision: string;
  if (view.respondable) {
    decision = `<section class="card" id="respond-section"><h2>Your response</h2>
      <p class="muted">Accepting lets ${e(biz.name)} know you would like to go ahead. It is not a payment.</p>
      <div id="respond-msg" hidden role="status" aria-live="polite"></div>
      <label for="respond-name">Your name (optional)</label>
      <input id="respond-name" maxlength="100" autocomplete="name">
      <button type="button" id="accept-btn" class="primary respond-btn">Accept estimate</button>
      <button type="button" id="decline-btn" class="secondary respond-btn">Decline</button>
    </section>`;
  } else if (est.status === 'accepted' || est.status === 'rejected') {
    const verb = est.status === 'accepted' ? 'accepted' : 'declined';
    const when = est.decidedAt ? ` on ${formatLongDate(est.decidedAt.slice(0, 10))}` : '';
    const who = est.decidedByName ? ` by ${est.decidedByName}` : '';
    decision = `<section class="card"><h2>${est.status === 'accepted' ? 'Accepted' : 'Declined'}</h2>
      <p>This estimate was ${verb}${e(who)}${e(when)}.</p>${est.convertedInvoiceId ? `<p class="muted">${e(biz.name)} has turned it into an invoice.</p>` : ''}</section>`;
  } else if (est.convertedInvoiceId) {
    decision = `<section class="card"><p>${e(biz.name)} has turned this estimate into an invoice.</p></section>`;
  } else {
    decision = `<section class="card"><h2>Expired</h2><p>This estimate expired on ${e(formatLongDate(est.expiryDate))}. Please contact ${e(biz.name)} if you would still like to go ahead.</p></section>`;
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>Estimate ${e(est.number)} from ${e(biz.name)}</title>
<style>
:root{--accent:${accent};--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f5f7fa}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:760px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:16px;padding:20px;margin:0 0 16px}
header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{margin:0;font-size:1.4rem;color:var(--accent)}h2{margin:0 0 8px;font-size:1.1rem}
.logo{max-height:56px;max-width:180px;display:block;margin-bottom:8px}.muted{color:var(--muted)}.small{font-size:.8rem}.strong{font-weight:700}.pre{white-space:pre-wrap}
.badge{display:inline-block;border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:2px 12px;font-weight:700;font-size:.85rem}
table{width:100%;border-collapse:collapse;margin-top:8px}th{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);text-align:right;padding:8px 6px;border-bottom:1px solid var(--line)}
th:first-child,td.desc{text-align:left}td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:top}td.num{text-align:right;white-space:nowrap}
.totals{margin-left:auto;max-width:320px;margin-top:12px}.trow{display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)}.trow.strong{color:var(--ink);font-weight:700}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:560px){.grid{grid-template-columns:1fr}}
button{min-height:48px;width:100%;border-radius:12px;font-size:1rem;font-weight:700;margin-top:12px}
button.primary{border:0;background:var(--accent);color:#fff}button.secondary{border:1px solid var(--line);background:#fff;color:var(--ink)}button:disabled{opacity:.55}
#respond-name{width:100%;min-height:44px;font-size:1rem;padding:0 12px;border:1px solid var(--line);border-radius:10px;margin-top:4px}
#respond-msg{padding:10px 12px;border-radius:10px;margin:8px 0;background:#eff6ff}#respond-msg.error{background:#fef2f2;color:#991b1b}
a.btn{display:inline-block;min-height:44px;line-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:12px;color:var(--ink);text-decoration:none;font-weight:600}
</style></head>
<body data-token="${e(opts.token)}"><main>
<section class="card"><header>
  <div>${opts.logoDataUri ? `<img class="logo" alt="" src="${e(opts.logoDataUri)}">` : ''}<strong>${e(biz.name)}</strong>
    <div class="muted small">${bizAddress}${biz.email ? `<br>${e(biz.email)}` : ''}${biz.phone ? `<br>${e(biz.phone)}` : ''}${biz.website ? `<br>${e(biz.website)}` : ''}${biz.taxNumber ? `<br>Tax no: ${e(biz.taxNumber)}` : ''}</div></div>
  <div style="text-align:right"><h1>Estimate ${e(est.number)}</h1><span class="badge">${e(STATUS[est.displayStatus] ?? est.displayStatus)}</span>
    <div class="muted small">Issued ${e(formatLongDate(est.issueDate))}<br>Valid until ${e(formatLongDate(est.expiryDate))}</div></div>
</header></section>
<section class="card grid"><div><h2>Prepared for</h2><strong>${e(customer.name)}</strong><div class="muted small">${custAddress}</div></div>
  <div><h2>Total</h2><div class="strong" style="font-size:1.6rem">${e(money(est.totalMinor, est.currency))}</div></div></section>
<section class="card"><table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table>
  <div class="totals">${totals}</div></section>
${decision}
${est.notes ? `<section class="card"><h2>Notes</h2><p class="pre">${e(est.notes)}</p></section>` : ''}
${est.terms ? `<section class="card"><h2>Terms and conditions</h2><p class="pre muted">${e(est.terms)}</p></section>` : ''}
<p><a class="btn" href="/public/estimates/${e(opts.token)}/pdf" download>Download PDF</a></p>
</main>
<script nonce="${e(opts.nonce)}">${CLIENT_JS}</script>
</body></html>`;
}
