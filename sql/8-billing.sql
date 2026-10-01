-- LOOPIN AI: Squad subscription billing. Paste all of this into Supabase SQL Editor and click Run.

create table public.squad_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null check (plan in ('starter','pro')),
  status text not null check (status in ('active','past_due','canceled')),
  squad_token_id text,
  squad_auth_code text,
  next_billing_at timestamptz,
  renewal_claimed_at timestamptz,
  last_transaction_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.squad_subscriptions enable row level security;
revoke all on public.squad_subscriptions from anon;
grant select, insert, update, delete on public.squad_subscriptions to authenticated;
grant all on public.squad_subscriptions to service_role;
create policy "No direct browser access to Squad subscriptions"
  on public.squad_subscriptions for all to authenticated using (false) with check (false);

create table public.squad_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  transaction_ref text not null unique,
  plan text not null check (plan in ('starter','pro')),
  amount integer not null check (amount > 0),
  currency text not null check (currency = 'USD'),
  checkout_url text,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
alter table public.squad_payments enable row level security;
revoke all on public.squad_payments from anon;
grant select, insert, update, delete on public.squad_payments to authenticated;
grant all on public.squad_payments to service_role;
create policy "No direct browser access to Squad payment records"
  on public.squad_payments for all to authenticated using (false) with check (false);
create index squad_payments_user_created_idx on public.squad_payments (user_id, created_at desc);
create unique index squad_payments_one_pending_per_user_idx on public.squad_payments (user_id) where status = 'pending';
create index squad_subscriptions_due_idx on public.squad_subscriptions (next_billing_at) where status = 'active';

create or replace function public.enforce_client_chat_plan()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  selected_plan text;
  chat_count integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  select case
    when p.trial_ends_at > now() then p.plan
    when s.status = 'active' or (s.status = 'canceled' and s.next_billing_at > now()) then s.plan
    else null
  end
  into selected_plan
  from public.profiles p
  left join public.squad_subscriptions s on s.user_id = p.id
  where p.id = auth.uid();

  if selected_plan is null then
    raise exception 'An active plan or trial is required to add a client chat.';
  end if;

  if selected_plan = 'starter' then
    select count(*) into chat_count
    from public.client_chats
    where user_id = auth.uid();
    if chat_count >= 5 then
      raise exception 'Starter includes up to 5 client chats.';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.enforce_client_chat_plan() from public, anon;
grant execute on function public.enforce_client_chat_plan() to authenticated, service_role;
create trigger enforce_client_chat_plan_before_insert
  before insert on public.client_chats
  for each row execute function public.enforce_client_chat_plan();
