-- LOOPIN AI: switch new Squad subscription payments to NGN. Run once in Supabase SQL Editor.

-- Abandon unfinished attempts created before the NGN switch; this does not alter completed payment history.
update public.squad_payments
set status = 'failed'
where status = 'pending';

-- Keep legacy USD records readable as history; application code now creates and accepts NGN only.
alter table public.squad_payments
  drop constraint if exists squad_payments_currency_check;
alter table public.squad_payments
  add constraint squad_payments_currency_check check (currency in ('NGN', 'USD'));
