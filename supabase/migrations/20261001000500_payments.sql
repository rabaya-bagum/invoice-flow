-- Online payments (Stripe Connect destination charges).

alter table payments add column application_fee_minor bigint not null default 0
  check (application_fee_minor >= 0);

-- At most ONE payment attempt in flight per invoice. Together with row locks and Stripe idempotency
-- keys this stops double charging from repeated clicks, two browsers, or retries.
create unique index payments_one_pending_per_invoice on payments (invoice_id) where status = 'pending';

create index payments_status_idx on payments (business_id, status, created_at desc);
