-- Support for invoice search and tax-rate defaults.

-- Minor-unit exponent per currency. Must match packages/shared/src/currency.ts
-- (an API integration test checks every supported currency against it).
create function currency_exponent(c char(3)) returns integer
language sql immutable as $$
  select case
    when c in ('JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF') then 0
    when c in ('BHD', 'KWD', 'OMR', 'JOD', 'TND') then 3
    else 2
  end
$$;

-- At most one default tax rate per business.
create unique index tax_rates_one_default on tax_rates (business_id) where is_default;

-- Customer history and search lookups.
create index invoices_business_customer_idx on invoices (business_id, customer_id, issue_date desc);
