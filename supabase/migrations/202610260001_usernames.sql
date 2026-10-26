begin;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or (username = lower(username) and username ~ '^[a-z0-9_]{3,30}$')
  )
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated, service_role;
grant update (username) on table public.profiles to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own username"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_username text := nullif(lower(btrim(new.raw_user_meta_data ->> 'username')), '');
begin
  insert into public.profiles (id, username) values (new.id, chosen_username);
  return new;
end;
$$;

revoke all on function public.create_user_profile() from public, anon, authenticated;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_user_profile();

-- Existing accounts choose a username in Settings after signing in with email.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- Availability reveals only whether a username can be selected, never an email.
create function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p_username)) ~ '^[a-z0-9_]{3,30}$'
    and not exists (
      select 1 from public.profiles where username = lower(btrim(p_username))
    );
$$;

revoke all on function public.is_username_available(text) from public, anon, authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- Only the trusted login endpoint may resolve a username to an Auth email.
create function public.resolve_username_email(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select users.email
    from public.profiles as profiles
    join auth.users as users on users.id = profiles.id
    where profiles.username = lower(btrim(p_username));
$$;

revoke all on function public.resolve_username_email(text) from public, anon, authenticated;
grant execute on function public.resolve_username_email(text) to service_role;

commit;
