-- Customer-facing estimate links and decisions.
alter table estimates
  add column viewed_at timestamptz,
  add column decided_at timestamptz,
  add column decided_by_name text check (char_length(decided_by_name) <= 100);

-- Like invoices.public_token: a random salt for signed share links (null = no active link).
comment on column estimates.public_token is 'Random salt for signed public share links; null = no active link';
