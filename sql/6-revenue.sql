-- LOOPIN AI: Revenue Sync. Paste all of this into Supabase SQL Editor and click Run.

-- The founder's own payment link (Paystack, Stripe, Flutterwave, anything that starts with https://)
alter table public.profiles
  add column payment_link text
  check (payment_link is null or (payment_link ~ '^https://' and char_length(payment_link) <= 500));
grant update (payment_link) on public.profiles to authenticated;

-- Every invoice Loopin sends
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null,
  client_name text not null,
  client_email text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null,
  description text,
  due_date date,
  status text not null default 'sent' check (status in ('sent','reminded','paid')),
  sent_at timestamptz not null default now(),
  reminded_at timestamptz,
  paid_at timestamptz
);
alter table public.invoices enable row level security;
grant select on public.invoices to authenticated;
grant update (status, paid_at) on public.invoices to authenticated;
create policy "Users can see their own invoices"
  on public.invoices for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can mark their own invoices as paid"
  on public.invoices for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id and status = 'paid');
grant all on public.invoices to service_role;
create index invoices_due_idx on public.invoices (status, sent_at);
