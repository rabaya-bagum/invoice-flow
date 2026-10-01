/**
 * Browser script for the pay page (served inline under a CSP nonce). It only talks to our own
 * API and Stripe.js; amounts are handled as integer minor units via string parsing (no floats).
 * Configuration comes from the JSON block #pay-config, never from string-built JavaScript.
 */
export const PAY_CLIENT_JS = String.raw`
(function () {
  var cfg = JSON.parse(document.getElementById('pay-config').textContent);
  var stripe = window.Stripe(cfg.publishableKey);
  var elements = null;
  var $ = function (id) { return document.getElementById(id); };
  var ERRORS = {
    INVOICE_NOT_PAYABLE: 'This invoice cannot be paid right now. Please reload the page.',
    PAYMENT_IN_PROGRESS: 'A payment for this invoice is already being processed. Please wait a moment.',
    AMOUNT_TOO_HIGH: 'That is more than the amount due.',
    AMOUNT_TOO_SMALL: 'That amount is below the minimum for card payments.',
    AMOUNT_UNSUPPORTED: 'That amount cannot be paid online. Try a different amount.',
    PAYMENTS_NOT_ENABLED: 'Online payment is not available for this invoice.',
    RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.'
  };

  function say(text, kind) {
    var el = $('pay-msg');
    el.textContent = text || '';
    el.className = kind || '';
    el.hidden = !text;
  }

  // "125.50" -> 12550 using the currency exponent; null if invalid. No floating point.
  function toMinor(text) {
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(text).trim().replace(/,/g, ''));
    if (!m) return null;
    var frac = m[2] || '';
    if (frac.length > cfg.exponent) return null;
    while (frac.length < cfg.exponent) frac += '0';
    var n = Number(m[1] + frac);
    return isFinite(n) && n > 0 ? n : null;
  }

  function currentAmount() {
    if ($('pay-mode-partial').checked) {
      var minor = toMinor($('pay-amount').value);
      if (minor === null) { say('Enter a valid amount, for example 100.00', 'error'); return undefined; }
      if (minor > cfg.balanceMinor) { say('That is more than the amount due.', 'error'); return undefined; }
      return minor;
    }
    return null; // null = full balance
  }

  async function start() {
    say('');
    var amount = currentAmount();
    if (amount === undefined) return;
    $('pay-start').disabled = true;
    try {
      var res = await fetch('/public/invoices/' + encodeURIComponent(cfg.token) + '/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(amount === null ? {} : { amountMinor: amount })
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var code = body && body.error && body.error.code;
        say(ERRORS[code] || 'We could not start the payment. Please try again.', 'error');
        $('pay-start').disabled = false;
        return;
      }
      elements = stripe.elements({
        clientSecret: body.clientSecret,
        appearance: { theme: 'stripe', variables: { colorPrimary: cfg.accent } }
      });
      elements.create('payment', { layout: 'tabs' }).mount('#payment-element');
      $('pay-choose').hidden = true;
      $('pay-form').hidden = false;
      $('pay-submit').textContent = 'Pay ' + body.amountLabel;
    } catch (e) {
      say('We could not reach the payment service. Check your connection and try again.', 'error');
      $('pay-start').disabled = false;
    }
  }

  async function submit(ev) {
    ev.preventDefault();
    if (!elements) return;
    $('pay-submit').disabled = true;
    say('Processing payment…');
    var result = await stripe.confirmPayment({
      elements: elements,
      confirmParams: { return_url: window.location.origin + window.location.pathname }
    });
    // confirmPayment only returns here on an immediate error; otherwise the browser redirects.
    if (result && result.error) {
      say(result.error.message || 'Your payment could not be completed.', 'error');
      $('pay-submit').disabled = false;
    }
  }

  async function poll(tries) {
    try {
      var res = await fetch('/public/invoices/' + encodeURIComponent(cfg.token));
      var inv = await res.json();
      if (inv.amountPaidMinor !== cfg.paidMinor || tries <= 0) {
        window.location.replace(window.location.pathname);
        return;
      }
    } catch (e) { /* keep waiting */ }
    setTimeout(function () { poll(tries - 1); }, 1500);
  }

  async function handleReturn() {
    var secret = new URLSearchParams(window.location.search).get('payment_intent_client_secret');
    if (!secret) return;
    var r = await stripe.retrievePaymentIntent(secret);
    var status = r && r.paymentIntent && r.paymentIntent.status;
    if (status === 'succeeded') {
      say('Payment received. Thank you! Updating your invoice…', 'ok');
      poll(8); // our server confirms via Stripe's webhook; wait for it, then reload
    } else if (status === 'processing') {
      say('Your payment is processing. This page will update when it completes.', 'ok');
      poll(8);
    } else {
      say('Your payment was not completed. You have not been charged. Please try again.', 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  $('pay-start').addEventListener('click', start);
  $('pay-form').addEventListener('submit', submit);
  var radios = document.querySelectorAll('input[name="pay-mode"]');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () { $('pay-amount-row').hidden = !$('pay-mode-partial').checked; });
  }
  handleReturn();
})();
`;
