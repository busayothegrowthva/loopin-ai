-- LOOPIN AI: personality choice. Paste all of this into Supabase SQL Editor and click Run.

alter table public.profiles
  add column assistant_tone text not null default 'professional'
  check (assistant_tone in ('professional','formal','friendly','casual'));
alter table public.profiles
  add column email_tone text not null default 'professional'
  check (email_tone in ('professional','formal','friendly','casual'));

grant update (assistant_tone, email_tone) on public.profiles to authenticated;
grant select on public.profiles to service_role;
