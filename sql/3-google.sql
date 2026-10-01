-- LOOPIN AI: Google connection. Paste all of this into Supabase SQL Editor and click Run.

-- Where each user's Google connection is kept.
-- The browser can see WHO is connected, but can never read the secret token.
create table public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  scopes text not null default '',
  connected_at timestamptz not null default now()
);
alter table public.google_connections enable row level security;
grant select (user_id, google_email, scopes, connected_at) on public.google_connections to authenticated;
create policy "Users can see their own Google connection status"
  on public.google_connections for select to authenticated
  using (auth.uid() = user_id);
grant all on public.google_connections to service_role;

-- Room to record what happened when a plan was carried out
alter table public.activity add column result text;
grant all on public.activity to service_role;
