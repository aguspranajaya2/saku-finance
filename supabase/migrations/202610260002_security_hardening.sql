begin;

-- Browser clients may edit transaction details, never server deduplication or origin metadata.
-- Revoke column ACLs too: a table-level REVOKE does not remove an existing column grant.
revoke insert, update on table public.transactions from authenticated;
revoke insert (id, user_id, kind, amount, category, description, transaction_date, source,
  telegram_update_id, receipt_storage_path, created_at) on public.transactions from authenticated;
revoke update (id, user_id, kind, amount, category, description, transaction_date, source,
  telegram_update_id, receipt_storage_path, created_at) on public.transactions from authenticated;
grant insert (user_id, kind, amount, category, description, transaction_date)
  on public.transactions to authenticated;
grant update (kind, amount, category, description, transaction_date)
  on public.transactions to authenticated;
grant all on table public.transactions to service_role;

create table public.security_rate_limits (
  bucket_key text primary key check (bucket_key ~ '^[a-f0-9]{64}$'),
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null
);
create index security_rate_limits_expiry_idx on public.security_rate_limits (expires_at);
alter table public.security_rate_limits enable row level security;
revoke all on table public.security_rate_limits from public, anon, authenticated;
grant all on table public.security_rate_limits to service_role;

-- Each caller supplies already-hashed scope keys, never raw emails, usernames, or IPs.
-- Lock every bucket in one order, then consume all of them or none of them.
create function public.consume_security_limits(p_limits jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  bucket record;
  checked_at timestamptz := pg_catalog.clock_timestamp();
  wait_seconds integer := 0;
begin
  if pg_catalog.jsonb_typeof(p_limits) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_limits) not between 1 and 8 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_limits) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object'
      or coalesce(item ->> 'key', '') !~ '^[a-f0-9]{64}$'
      or coalesce(item ->> 'limit', '') !~ '^[0-9]{1,6}$'
      or coalesce(item ->> 'window_seconds', '') !~ '^[0-9]{1,6}$' then
      raise exception 'Invalid rate limit configuration' using errcode = '22023';
    end if;
    if (item ->> 'limit')::integer not between 1 and 10000
      or (item ->> 'window_seconds')::integer not between 1 and 86400 then
      raise exception 'Invalid rate limit configuration' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(distinct value ->> 'key')
      from pg_catalog.jsonb_array_elements(p_limits)) <> pg_catalog.jsonb_array_length(p_limits) then
    raise exception 'Duplicate rate limit bucket' using errcode = '22023';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_limits) order by value ->> 'key' loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:limit:' || (item ->> 'key'), 0));
  end loop;
  -- Read the time after waiting on locks so expired windows cannot be prolonged by contention.
  checked_at := pg_catalog.clock_timestamp();
  for item in select value from pg_catalog.jsonb_array_elements(p_limits) loop
    select request_count, expires_at into bucket from public.security_rate_limits
      where bucket_key = item ->> 'key';
    if found and bucket.expires_at > checked_at and bucket.request_count >= (item ->> 'limit')::integer then
      wait_seconds := greatest(wait_seconds, pg_catalog.ceil(extract(epoch from (bucket.expires_at - checked_at)))::integer);
    end if;
  end loop;
  if wait_seconds > 0 then
    return pg_catalog.jsonb_build_object('allowed', false, 'retry_after', wait_seconds);
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_limits) order by value ->> 'key' loop
    insert into public.security_rate_limits as existing (bucket_key, request_count, expires_at)
      values (item ->> 'key', 1, checked_at + pg_catalog.make_interval(secs => (item ->> 'window_seconds')::integer))
      on conflict (bucket_key) do update set
        request_count = case when existing.expires_at <= checked_at then 1 else existing.request_count + 1 end,
        expires_at = case when existing.expires_at <= checked_at then excluded.expires_at else existing.expires_at end;
  end loop;
  -- Cleanup is bounded and skips rows another request already holds; never reverse the lock order.
  delete from public.security_rate_limits where bucket_key in (
    select bucket_key from public.security_rate_limits where expires_at < checked_at - interval '1 day'
      order by expires_at limit 100 for update skip locked
  );
  return pg_catalog.jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;
revoke all on function public.consume_security_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_security_limits(jsonb) to service_role;

create table public.receipt_processing_jobs (
  telegram_update_id bigint primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id bigint not null,
  status text not null check (status in ('processing', 'done')),
  lease_id uuid not null,
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index receipt_processing_jobs_active_idx on public.receipt_processing_jobs (lease_expires_at)
  where status = 'processing';
alter table public.receipt_processing_jobs enable row level security;
revoke all on table public.receipt_processing_jobs from public, anon, authenticated;
grant all on table public.receipt_processing_jobs to service_role;

-- Pairing, callbacks, disconnect, and job claims share a short binding lock. This makes
-- checking the current account/chat connection atomic with changing that connection.
create or replace function public.redeem_telegram_pairing_code(p_code_hash text, p_chat_id bigint)
returns table (linked_user_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairing public.telegram_pairing_codes%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding', 0));
  select * into pairing from public.telegram_pairing_codes where code_hash = p_code_hash for update;
  if not found or pairing.expires_at <= pg_catalog.now() or p_chat_id is null or p_chat_id <= 0 then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;
  perform 1 from public.telegram_connections where user_id = pairing.user_id for update;
  insert into public.telegram_connections (user_id, chat_id) values (pairing.user_id, p_chat_id)
    on conflict (user_id) do update set chat_id = excluded.chat_id, linked_at = pg_catalog.now();
  -- A new successful pairing revokes all existing confirmation buttons, including
  -- when the user deliberately pairs the same chat again.
  delete from public.pending_receipts where user_id = pairing.user_id;
  delete from public.telegram_pairing_codes where code_hash = p_code_hash;
  return query select pairing.user_id, 'linked'::text;
exception when unique_violation then
  return query select null::uuid, 'chat_in_use'::text;
end;
$$;
revoke all on function public.redeem_telegram_pairing_code(text, bigint) from public, anon, authenticated;
grant execute on function public.redeem_telegram_pairing_code(text, bigint) to service_role;

create or replace function public.confirm_pending_receipt(p_pending_receipt_id uuid, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.pending_receipts%rowtype;
  saved public.transactions%rowtype;
  saved_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding', 0));
  select * into receipt from public.pending_receipts where id = p_pending_receipt_id and chat_id = p_chat_id;
  if not found then return 'invalid'; end if;
  perform 1 from public.telegram_connections where user_id = receipt.user_id and chat_id = p_chat_id for update;
  if not found then return 'invalid'; end if;
  select * into receipt from public.pending_receipts where id = p_pending_receipt_id and chat_id = p_chat_id for update;
  if not found or receipt.expires_at <= pg_catalog.now() then return 'invalid'; end if;

  insert into public.transactions (user_id, kind, amount, category, description, transaction_date, source, telegram_update_id)
    values (receipt.user_id, 'expense', receipt.amount, receipt.category, receipt.merchant,
      receipt.transaction_date, 'receipt', receipt.telegram_update_id)
    on conflict (telegram_update_id) do nothing returning id into saved_id;
  if saved_id is null then
    select * into saved from public.transactions where telegram_update_id = receipt.telegram_update_id;
    if not found or saved.user_id <> receipt.user_id or saved.source <> 'receipt' or saved.kind <> 'expense'
      or saved.amount <> receipt.amount or saved.category <> receipt.category
      or saved.description <> receipt.merchant or saved.transaction_date <> receipt.transaction_date then
      return 'conflict';
    end if;
  end if;
  delete from public.pending_receipts where id = receipt.id;
  return 'confirmed';
end;
$$;
revoke all on function public.confirm_pending_receipt(uuid, bigint) from public, anon, authenticated;
grant execute on function public.confirm_pending_receipt(uuid, bigint) to service_role;

create function public.cancel_pending_receipt(p_pending_receipt_id uuid, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.pending_receipts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding', 0));
  select * into receipt from public.pending_receipts where id = p_pending_receipt_id and chat_id = p_chat_id;
  if not found then return 'invalid'; end if;
  perform 1 from public.telegram_connections where user_id = receipt.user_id and chat_id = p_chat_id for update;
  if not found then return 'invalid'; end if;
  delete from public.pending_receipts where id = receipt.id and chat_id = p_chat_id and expires_at > pg_catalog.now();
  if found then return 'cancelled'; end if;
  return 'invalid';
end;
$$;
revoke all on function public.cancel_pending_receipt(uuid, bigint) from public, anon, authenticated;
grant execute on function public.cancel_pending_receipt(uuid, bigint) to service_role;

create function public.disconnect_telegram()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding', 0));
  perform 1 from public.telegram_connections where user_id = current_user_id for update;
  delete from public.pending_receipts where user_id = current_user_id;
  delete from public.telegram_pairing_codes where user_id = current_user_id;
  delete from public.telegram_connections where user_id = current_user_id;
  return true;
end;
$$;
revoke all on function public.disconnect_telegram() from public, anon, authenticated;
grant execute on function public.disconnect_telegram() to authenticated;

-- A lease prevents duplicated updates and bounds OCR work across server instances.
-- Completing a job means OCR handling finished, not that a transaction was saved.
create function public.claim_receipt_job(p_update_id bigint, p_user_id uuid, p_chat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.receipt_processing_jobs%rowtype;
  checked_at timestamptz;
  quota jsonb;
  new_lease_id uuid;
begin
  if p_update_id is null or p_update_id < 0 or p_user_id is null or p_chat_id is null or p_chat_id <= 0 then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding', 0));
  perform 1 from public.telegram_connections where user_id = p_user_id and chat_id = p_chat_id for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'unlinked'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ocr-jobs', 0));
  checked_at := pg_catalog.clock_timestamp();
  select * into job from public.receipt_processing_jobs where telegram_update_id = p_update_id for update;
  if found and (job.user_id <> p_user_id or job.chat_id <> p_chat_id or job.status = 'done' or job.lease_expires_at > checked_at) then
    return pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;
  if exists (select 1 from public.pending_receipts where telegram_update_id = p_update_id)
    or exists (select 1 from public.transactions where telegram_update_id = p_update_id) then
    return pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;
  if (select pg_catalog.count(*) from public.receipt_processing_jobs
      where status = 'processing' and lease_expires_at > checked_at) >= 2 then
    return pg_catalog.jsonb_build_object('status', 'busy');
  end if;
  quota := public.consume_security_limits(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('key', pg_catalog.md5('saku:ocr:minute:' || p_user_id::text)
      || pg_catalog.md5('saku:ocr:minute:scope:' || p_user_id::text), 'limit', 3, 'window_seconds', 60),
    pg_catalog.jsonb_build_object('key', pg_catalog.md5('saku:ocr:day:' || p_user_id::text)
      || pg_catalog.md5('saku:ocr:day:scope:' || p_user_id::text), 'limit', 20, 'window_seconds', 86400)
  ));
  if not (quota ->> 'allowed')::boolean then return pg_catalog.jsonb_build_object('status', 'rate_limited'); end if;
  new_lease_id := pg_catalog.gen_random_uuid();
  insert into public.receipt_processing_jobs (telegram_update_id, user_id, chat_id, status, lease_id, lease_expires_at)
    values (p_update_id, p_user_id, p_chat_id, 'processing', new_lease_id, checked_at + interval '180 seconds')
    on conflict (telegram_update_id) do update set status = 'processing', lease_id = excluded.lease_id,
      lease_expires_at = excluded.lease_expires_at, completed_at = null;
  delete from public.receipt_processing_jobs where telegram_update_id in (
    select telegram_update_id from public.receipt_processing_jobs where lease_expires_at < checked_at - interval '7 days'
      order by lease_expires_at limit 100 for update skip locked
  );
  return pg_catalog.jsonb_build_object('status', 'claimed', 'lease_id', new_lease_id);
end;
$$;
revoke all on function public.claim_receipt_job(bigint, uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_receipt_job(bigint, uuid, bigint) to service_role;

create function public.finish_receipt_job(p_update_id bigint, p_user_id uuid, p_lease_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ocr-jobs', 0));
  update public.receipt_processing_jobs set status = 'done', completed_at = pg_catalog.clock_timestamp(),
    lease_expires_at = pg_catalog.clock_timestamp()
    where telegram_update_id = p_update_id and user_id = p_user_id and lease_id = p_lease_id and status = 'processing';
  return found;
end;
$$;
revoke all on function public.finish_receipt_job(bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_receipt_job(bigint, uuid, uuid) to service_role;

commit;
