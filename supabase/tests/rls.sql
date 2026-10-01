-- Run after migrations. Fails (ON_ERROR_STOP) if any assertion is wrong.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

-- signup trigger created a profile + business for each user
do $$ begin
  assert (select count(*) from business_profiles) = 2, 'signup trigger should create businesses';
end $$;

-- seed tenant data as the (RLS-bypassing) service
do $$
declare ba uuid; bb uuid; ca uuid; cb uuid; ia uuid; n1 text; n2 text;
begin
  select id into ba from business_profiles where email = 'a@example.com';
  select id into bb from business_profiles where email = 'b@example.com';
  insert into customers (business_id, company_name) values (ba, 'A Co') returning id into ca;
  insert into customers (business_id, company_name) values (bb, 'B Co') returning id into cb;
  n1 := next_document_number(ba, 'invoice');
  n2 := next_document_number(ba, 'invoice');
  assert n1 = 'INV-0001' and n2 = 'INV-0002', 'numbering should increment: ' || n1 || ',' || n2;
  assert next_document_number(bb, 'invoice') = 'INV-0001', 'numbering is per business';
  insert into invoices (business_id, customer_id, number, issue_date, due_date, currency, total_minor, amount_paid_minor)
  values (ba, ca, n1, current_date, current_date + 14, 'USD', 100000, 40000) returning id into ia;
  assert (select balance_due_minor from invoices where id = ia) = 60000, 'balance_due is generated';
  insert into invoices (business_id, customer_id, number, issue_date, due_date, currency)
  values (bb, cb, 'INV-0001', current_date, current_date, 'USD');
end $$;

-- constraints
do $$ begin
  begin
    insert into invoices (business_id, customer_id, number, issue_date, due_date, currency, discount_type, discount_value)
    select business_id, customer_id, 'X-1', current_date, current_date, 'USD', 'percent', 10001 from invoices limit 1;
    raise exception 'percent discount > 100%% was accepted';
  exception when check_violation then null; end;
  begin
    insert into invoices (business_id, customer_id, number, issue_date, due_date, currency)
    select business_id, customer_id, number, current_date, current_date, 'USD' from invoices limit 1;
    raise exception 'duplicate invoice number was accepted';
  exception when unique_violation then null; end;
  begin
    insert into invoices (business_id, customer_id, number, issue_date, due_date, currency)
    select business_id, customer_id, 'X-2', current_date, current_date, 'usd' from invoices limit 1;
    raise exception 'lowercase currency was accepted';
  exception when check_violation then null; end;
end $$;

-- user A sees only A
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from invoices) = 1, 'A should see exactly 1 invoice';
  assert (select count(*) from customers where company_name = 'B Co') = 0, 'A must not see B customers';
  assert (select count(*) from business_profiles) = 1, 'A sees own business only';
  begin
    update invoices set total_minor = 1;
    raise exception 'client UPDATE on invoices was allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into payments (business_id, invoice_id, amount_minor, currency)
    select business_id, id, 100, 'USD' from invoices limit 1;
    raise exception 'client INSERT on payments was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from audit_logs;
    raise exception 'client SELECT on audit_logs was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform next_document_number(current_business_id(), 'invoice');
    raise exception 'client could call next_document_number';
  exception when insufficient_privilege then null; end;
end $$;

-- user B sees only B
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from invoices) = 1, 'B should see exactly 1 invoice';
  assert (select count(*) from invoices where number = 'INV-0002') = 0, 'B must not see A invoices';
end $$;

-- anon sees nothing and cannot even select
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from invoices;
    raise exception 'anon SELECT on invoices was allowed';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
\echo RLS and constraint checks passed
