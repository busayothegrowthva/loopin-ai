-- LOOPIN AI: activity list. Paste all of this into Supabase SQL Editor and click Run.

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('calendar_event','email','task','reminder','invoice','doc','sheet_row')),
  title text not null check (char_length(title) between 1 and 200),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) < 10000),
  status text not null default 'approved' check (status in ('approved','done','failed')),
  created_at timestamptz not null default now()
);
alter table public.activity enable row level security;
grant select, insert on public.activity to authenticated;
create policy "Users can read their own activity"
  on public.activity for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can add their own approved activity"
  on public.activity for insert to authenticated
  with check (auth.uid() = user_id and status = 'approved');
create index activity_user_created_idx on public.activity (user_id, created_at desc);
