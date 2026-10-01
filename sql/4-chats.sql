-- LOOPIN AI: client chats and permission switches. Paste all of this into Supabase SQL Editor and click Run.

-- One row per client chat. Every switch starts OFF.
create table public.client_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  commitment_sync boolean not null default false,
  revenue_sync boolean not null default false,
  consistency_watch boolean not null default false,
  accuracy_watch boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.client_chats enable row level security;
grant select, insert, delete on public.client_chats to authenticated;
grant update (name, commitment_sync, revenue_sync, consistency_watch, accuracy_watch) on public.client_chats to authenticated;
create policy "Users can see their own chats" on public.client_chats for select to authenticated using (auth.uid() = user_id);
create policy "Users can add their own chats" on public.client_chats for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can change their own chats" on public.client_chats for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own chats" on public.client_chats for delete to authenticated using (auth.uid() = user_id);
grant all on public.client_chats to service_role;

-- The text of each chat Loopin was allowed to read. Only the server can add to it.
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.client_chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 6000),
  added_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
grant select, delete on public.chat_messages to authenticated;
create policy "Users can see their own chat text" on public.chat_messages for select to authenticated using (auth.uid() = user_id);
create policy "Users can delete their own chat text" on public.chat_messages for delete to authenticated using (auth.uid() = user_id);
grant all on public.chat_messages to service_role;
create index chat_messages_chat_idx on public.chat_messages (chat_id, added_at desc);
