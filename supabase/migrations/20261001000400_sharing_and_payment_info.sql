-- Payment instructions printed on invoices (bank details, e-transfer address, ...).
alter table business_profiles add column payment_instructions text;

-- invoices.public_token now stores a random per-invoice salt, NOT the link token itself.
-- Share links are HMAC(secret, invoice_id || salt), so a database leak alone does not expose
-- links, and clearing the salt revokes a link.
comment on column invoices.public_token is 'Random salt for signed public share links; null = no active link';
