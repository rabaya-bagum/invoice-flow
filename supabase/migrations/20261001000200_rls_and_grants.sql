-- Access model (see docs/ASSUMPTIONS.md):
--  * All writes go through the Express API using the service role, with business scoping
--    enforced in code. This keeps server-side money calculation un-bypassable.
--  * Signed-in clients (role `authenticated`) get read-only access to their own rows, as a
--    second layer of defence against IDOR (e.g. if someone queries PostgREST directly).
--  * The anon role gets nothing.

create function current_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from business_profiles where owner_id = auth.uid()
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function current_business_id() to authenticated;

-- Future tables are closed by default too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Enable RLS everywhere. Tables with no policy (webhook_events, audit_logs,
-- document_sequences) are deny-all for client roles.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

grant select on profiles, business_profiles, customers, tax_rates, products, invoices,
  invoice_items, payments, estimates, estimate_items, invoice_activity, notifications,
  push_tokens to authenticated;

create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid());
create policy business_select on business_profiles for select to authenticated
  using (owner_id = auth.uid());
create policy push_tokens_select on push_tokens for select to authenticated
  using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'tax_rates', 'products', 'invoices', 'invoice_items', 'payments',
    'estimates', 'estimate_items', 'invoice_activity', 'notifications'
  ] loop
    execute format(
      'create policy %I on %I for select to authenticated using (business_id = current_business_id())',
      t || '_select', t);
  end loop;
end $$;

-- Notifications: the client may mark its own as read (the only client write).
grant update (read_at) on notifications to authenticated;
create policy notifications_mark_read on notifications for update to authenticated
  using (business_id = current_business_id()) with check (business_id = current_business_id());
