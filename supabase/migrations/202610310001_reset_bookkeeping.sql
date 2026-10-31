begin;

-- These contain only reset receipts and deduplication identifiers, never amounts
-- or journal descriptions. Retrying a completed reset must not erase new books.
create table public.bookkeeping_resets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default clock_timestamp(),
  result jsonb not null default '{}',
  unique(id,user_id)
);
create index bookkeeping_resets_owner_idx on public.bookkeeping_resets(user_id,completed_at desc);
create table public.bookkeeping_retired_keys (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reset_id uuid not null,
  request_id uuid,
  telegram_update_id bigint,
  foreign key(reset_id,user_id) references public.bookkeeping_resets(id,user_id) on delete cascade,
  check (num_nonnulls(request_id,telegram_update_id) = 1),
  unique(user_id,request_id), unique(telegram_update_id)
);
alter table public.bookkeeping_resets enable row level security;
alter table public.bookkeeping_retired_keys enable row level security;
revoke all on public.bookkeeping_resets,public.bookkeeping_retired_keys from public,anon,authenticated,service_role;

-- Same lock as every ledger writer. Requests already running before a reset and
-- retries of erased requests cannot quietly put old transactions back.
create function public._guard_reset_bookkeeping_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() <> new.user_id then
    raise exception 'Account ownership required' using errcode = '42501';
  end if;
  if tg_table_name = 'transactions' and new.source in ('telegram','receipt') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding',0));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || new.user_id::text,0));
  if exists(select 1 from public.bookkeeping_resets where user_id = new.user_id and completed_at > pg_catalog.transaction_timestamp()) then
    raise exception 'Books were reset; refresh before posting' using errcode = '40001';
  end if;
  if new.telegram_update_id is not null and exists(select 1 from public.bookkeeping_retired_keys where telegram_update_id = new.telegram_update_id) then
    raise exception 'Transaction was removed by a reset' using errcode = '40001';
  end if;
  if tg_table_name = 'journal_entries' then
    if new.request_id is not null and exists(select 1 from public.bookkeeping_retired_keys where user_id = new.user_id and request_id = new.request_id) then
      raise exception 'Journal was removed by a reset' using errcode = '40001';
    end if;
  elsif new.source in ('telegram','receipt') and exists(select 1 from public.bookkeeping_resets where user_id = new.user_id)
    and not exists(select 1 from public.telegram_connections where user_id = new.user_id) then
    raise exception 'Telegram connection was revoked' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public._guard_reset_bookkeeping_write() from public,anon,authenticated,service_role;
create trigger guard_reset_journal before insert on public.journal_entries for each row execute function public._guard_reset_bookkeeping_write();
create trigger guard_reset_transaction before insert on public.transactions for each row execute function public._guard_reset_bookkeeping_write();

-- A worker may finish reading a picture after reset/re-pairing. Its cancelled
-- lease cannot create a new confirmation button, even in the same chat.
create function public._guard_reset_pending_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare reset_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || new.user_id::text,0));
  select max(completed_at) into reset_at from public.bookkeeping_resets where user_id = new.user_id;
  if reset_at is not null then
    if not exists(select 1 from public.telegram_connections where user_id = new.user_id and chat_id = new.chat_id)
      or not exists(select 1 from public.receipt_processing_jobs where user_id = new.user_id and chat_id = new.chat_id
        and telegram_update_id = new.telegram_update_id and status = 'processing' and created_at > reset_at and lease_expires_at > pg_catalog.clock_timestamp())
      or exists(select 1 from public.bookkeeping_retired_keys where telegram_update_id = new.telegram_update_id) then
      raise exception 'Receipt belongs to an earlier bookkeeping session' using errcode = '40001';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public._guard_reset_pending_receipt() from public,anon,authenticated,service_role;
create trigger guard_reset_pending_receipt before insert on public.pending_receipts for each row execute function public._guard_reset_pending_receipt();

-- Service-only: the API must verify the current session, password and explicit
-- confirmation. There is no browser-callable owner-id deletion function.
create function public.reset_user_bookkeeping(p_user_id uuid,p_request_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous public.bookkeeping_resets%rowtype; journals integer; transactions integer; receipts integer; output jsonb;
begin
  if p_user_id is null or p_request_id is null or p_confirmation is distinct from 'RESET' then
    raise exception 'Explicit reset confirmation required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || p_user_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ocr-jobs',0));
  perform 1 from auth.users where id = p_user_id;
  if not found then raise exception 'Account unavailable' using errcode = '42501'; end if;
  select * into previous from public.bookkeeping_resets where id = p_request_id;
  if found then
    if previous.user_id <> p_user_id then raise exception 'Invalid reset request' using errcode = '22023'; end if;
    return previous.result;
  end if;
  insert into public.bookkeeping_resets(id,user_id) values(p_request_id,p_user_id);
  insert into public.bookkeeping_retired_keys(user_id,reset_id,request_id)
    select p_user_id,p_request_id,request_id from public.journal_entries where user_id = p_user_id and request_id is not null on conflict do nothing;
  insert into public.bookkeeping_retired_keys(user_id,reset_id,telegram_update_id)
    select p_user_id,p_request_id,telegram_update_id from (
      select telegram_update_id from public.journal_entries where user_id = p_user_id
      union select telegram_update_id from public.transactions where user_id = p_user_id
      union select telegram_update_id from public.pending_receipts where user_id = p_user_id
      union select telegram_update_id from public.receipt_processing_jobs where user_id = p_user_id
    ) updates where telegram_update_id is not null on conflict do nothing;

  -- Remove mappings before the legacy DELETE trigger, including already-reversed
  -- entries. Never disable triggers/RLS or alter permissions for the whole table.
  delete from public.legacy_ledger_links where entry_id in (select id from public.journal_entries where user_id = p_user_id);
  delete from public.transactions where user_id = p_user_id;
  get diagnostics transactions = row_count;
  delete from public.journal_entries where user_id = p_user_id;
  get diagnostics journals = row_count;
  delete from public.pending_receipts where user_id = p_user_id;
  get diagnostics receipts = row_count;
  delete from public.telegram_pairing_codes where user_id = p_user_id;
  delete from public.telegram_connections where user_id = p_user_id;
  update public.receipt_processing_jobs set status = 'done',completed_at = pg_catalog.clock_timestamp(),lease_expires_at = pg_catalog.clock_timestamp()
    where user_id = p_user_id and status = 'processing';
  -- Accounts, username, Auth identity and browser preferences are preserved.
  output := pg_catalog.jsonb_build_object('status','reset','request_id',p_request_id,'journals_removed',journals,'transactions_removed',transactions,'receipts_removed',receipts);
  update public.bookkeeping_resets set result = output,completed_at = pg_catalog.clock_timestamp() where id = p_request_id;
  return output;
end; $$;
revoke all on function public.reset_user_bookkeeping(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reset_user_bookkeeping(uuid,uuid,text) to service_role;

commit;
