-- LOOPIN AI: accuracy watch business facts. Paste all of this into Supabase SQL Editor and click Run.

alter table public.profiles
  add column business_facts text check (business_facts is null or char_length(business_facts) between 1 and 20000);

grant update (business_facts) on public.profiles to authenticated;
