-- LOOPIN AI: database setup. Paste all of this into Supabase SQL Editor and click Run.

-- 1. Where contact form messages are saved
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 5 and 200),
  message text not null check (char_length(message) between 5 and 2000),
  created_at timestamptz not null default now()
);
alter table public.contact_messages enable row level security;
grant insert on public.contact_messages to anon, authenticated;
create policy "Anyone can send a contact message"
  on public.contact_messages for insert to anon, authenticated
  with check (true);

-- 2. One profile per user (name, plan, trial end date)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  plan text not null default 'starter' check (plan in ('starter','pro')),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- 3. Create the profile automatically when someone signs up
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, plan)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    case when new.raw_user_meta_data->>'plan' = 'pro' then 'pro' else 'starter' end
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated;
