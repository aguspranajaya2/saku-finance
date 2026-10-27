-- Exact two-decimal rupiah. Run AFTER 202610270001_double_entry_ledger.sql.
-- Amounts stay in rupiah: 30000 remains 30000, never multiplied or rewritten.
-- Unconstrained numeric + CHECK rejects extra precision instead of rounding it.
begin;
lock table public.transactions,public.pending_receipts,public.journal_lines in access exclusive mode;
-- PostgreSQL requires removing the column-specific trigger while changing its type.
-- The enclosing transaction and locks prevent any gap in legacy synchronization.
drop trigger sync_transaction_ledger on public.transactions;
alter table public.transactions alter column amount type numeric using amount::numeric;
alter table public.pending_receipts alter column amount type numeric using amount::numeric;
alter table public.journal_lines alter column debit type numeric using debit::numeric,
  alter column credit type numeric using credit::numeric;
alter table public.transactions add constraint transaction_amount_precision check (scale(amount) <= 2 and amount <= 9007199254740991);
alter table public.pending_receipts add constraint receipt_amount_precision check (scale(amount) <= 2 and amount <= 9007199254740991);
alter table public.journal_lines add constraint journal_line_precision check (scale(debit) <= 2 and scale(credit) <= 2);
-- Text transport prevents JSON/JavaScript precision loss, even for large values.
alter table public.journal_lines add column debit_exact text generated always as (debit::text) stored,
  add column credit_exact text generated always as (credit::text) stored;
alter table public.pending_receipts add column amount_exact text generated always as (amount::text) stored;
create trigger sync_transaction_ledger after insert or delete or update of kind,amount,category,description,transaction_date
  on public.transactions for each row execute function public._sync_legacy_transaction();

create or replace function public._write_journal(
  p_user_id uuid,p_date date,p_memo text,p_type text,p_category text,p_lines jsonb,p_source text,
  p_legacy_id uuid default null,p_reversal_of uuid default null,p_update_id bigint default null,
  p_request_id uuid default null,p_payload jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare entry uuid; item jsonb; position integer := 0; total_debit numeric := 0; total_credit numeric := 0;
  line_debit numeric; line_credit numeric; target_account uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || p_user_id::text,0));
  if p_date is null or length(btrim(p_memo)) not between 1 and 240 or length(p_category) not between 1 and 60
    or pg_catalog.jsonb_typeof(p_lines) is distinct from 'array' or pg_catalog.jsonb_array_length(p_lines) not between 2 and 20 then
    raise exception 'Invalid journal' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_lines) loop
    if coalesce(item->>'debit','') !~ '^[0-9]{1,16}([.][0-9]{1,2})?$' or coalesce(item->>'credit','') !~ '^[0-9]{1,16}([.][0-9]{1,2})?$' then
      raise exception 'Use positive rupiah amounts with at most two decimals' using errcode = '22023';
    end if;
    line_debit := (item->>'debit')::numeric; line_credit := (item->>'credit')::numeric;
    if line_debit > 9007199254740991 or line_credit > 9007199254740991
      or not ((line_debit > 0 and line_credit = 0) or (line_credit > 0 and line_debit = 0)) then
      raise exception 'Invalid journal amount' using errcode = '22023';
    end if;
    target_account := (item->>'account_id')::uuid;
    if not exists(select 1 from public.ledger_accounts where id = target_account and user_id = p_user_id) then
      raise exception 'Account is unavailable' using errcode = '42501';
    end if;
    if p_type = 'closing' and exists(select 1 from public.ledger_accounts where id = target_account and account_type in ('asset','liability')) then
      raise exception 'Closing entries use only revenue, expense and equity accounts' using errcode = '22023';
    end if;
    total_debit := total_debit + line_debit; total_credit := total_credit + line_credit;
  end loop;
  if total_debit <> total_credit or total_debit > 9007199254740991 or
    (select count(distinct value->>'account_id') from pg_catalog.jsonb_array_elements(p_lines)) < 2 then
    raise exception 'Debit and credit must balance across at least two accounts' using errcode = '23514';
  end if;
  insert into public.journal_entries(user_id,entry_date,memo,entry_type,category,source,legacy_transaction_id,
    reversal_of,telegram_update_id,request_id,request_payload)
    values(p_user_id,p_date,btrim(p_memo),p_type,p_category,p_source,p_legacy_id,p_reversal_of,p_update_id,p_request_id,p_payload)
    returning id into entry;
  for item in select value from pg_catalog.jsonb_array_elements(p_lines) loop
    position := position + 1;
    insert into public.journal_lines(user_id,entry_id,account_id,line_no,debit,credit)
      values(p_user_id,entry,(item->>'account_id')::uuid,position,(item->>'debit')::numeric,(item->>'credit')::numeric);
  end loop;
  return entry;
end; $$;
revoke all on function public._write_journal(uuid,date,text,text,text,jsonb,text,uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;

drop function public.record_opening_balance(uuid,bigint,date);
create function public.record_opening_balance(p_account_id uuid,p_amount numeric,p_entry_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); account public.ledger_accounts%rowtype; prior public.journal_entries%rowtype;
  prior_amount numeric; equity uuid; dr uuid; cr uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || owner_id::text,0));
  select * into account from public.ledger_accounts where id = p_account_id and user_id = owner_id;
  if not found then raise exception 'Account is unavailable' using errcode = '42501'; end if;
  if account.account_type not in ('asset','liability') or p_amount is null or p_amount = 0 or scale(p_amount) > 2 or abs(p_amount::numeric) > 9007199254740991 then
    raise exception 'Invalid opening balance' using errcode = '22023'; end if;
  select e.* into prior from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    where l.account_id = account.id and e.entry_type = 'opening' and e.reversed_by is null limit 1;
  if found then
    select case when account.account_type = 'asset' then debit-credit else credit-debit end into prior_amount
      from public.journal_lines where entry_id = prior.id and account_id = account.id;
    if prior.entry_date = p_entry_date and prior_amount = p_amount then return prior.id; end if;
    raise exception 'Reverse the previous opening balance first' using errcode = '22023';
  end if;
  if exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    where l.account_id = account.id and e.entry_date < p_entry_date) then
    raise exception 'Opening date must precede account activity' using errcode = '22023'; end if;
  select id into equity from public.ledger_accounts where user_id = owner_id and role = 'opening_equity';
  if (account.account_type = 'asset' and p_amount > 0) or (account.account_type = 'liability' and p_amount < 0)
    then dr := account.id; cr := equity; else dr := equity; cr := account.id; end if;
  return public._write_journal(owner_id,p_entry_date,'Opening balance: ' || account.name,'opening','Saldo awal',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account_id',dr,'debit',abs(p_amount),'credit',0),
      pg_catalog.jsonb_build_object('account_id',cr,'debit',0,'credit',abs(p_amount))),'web');
end; $$;
revoke all on function public.record_opening_balance(uuid,numeric,date) from public,anon,authenticated,service_role;
grant execute on function public.record_opening_balance(uuid,numeric,date) to authenticated;

drop function public.create_ledger_account(text,text,text,text,bigint,date);
create function public.create_ledger_account(p_code text,p_name text,p_account_type text,p_role text default 'general',
  p_opening_balance numeric default 0,p_opening_date date default current_date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); account uuid; equity uuid; debit_account uuid; credit_account uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_role = 'opening_equity' or p_opening_balance is null or scale(p_opening_balance) > 2 or abs(p_opening_balance::numeric) > 9007199254740991
    or (p_opening_balance <> 0 and p_account_type not in ('asset','liability')) then
    raise exception 'Opening balances are only supported for assets and liabilities' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || owner_id::text,0));
  insert into public.ledger_accounts(user_id,code,name,account_type,role)
    values(owner_id,btrim(p_code),btrim(p_name),p_account_type,p_role) returning id into account;
  if p_opening_balance <> 0 then
    select id into equity from public.ledger_accounts where user_id = owner_id and role = 'opening_equity';
    if (p_account_type = 'asset' and p_opening_balance > 0) or (p_account_type = 'liability' and p_opening_balance < 0)
      then debit_account := account; credit_account := equity; else debit_account := equity; credit_account := account; end if;
    perform public._write_journal(owner_id,p_opening_date,'Opening balance: ' || btrim(p_name),'opening','Saldo awal',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account_id',debit_account,'debit',abs(p_opening_balance),'credit',0),
        pg_catalog.jsonb_build_object('account_id',credit_account,'debit',0,'credit',abs(p_opening_balance))),'web');
  end if;
  return account;
end; $$;
revoke all on function public.create_ledger_account(text,text,text,text,numeric,date) from public,anon,authenticated,service_role;
grant execute on function public.create_ledger_account(text,text,text,text,numeric,date) to authenticated;

drop function public.post_telegram_journal(bigint,bigint,date,text,text,text,text,text,bigint);
create function public.post_telegram_journal(p_chat_id bigint,p_update_id bigint,p_entry_date date,p_memo text,p_entry_type text,
  p_category text,p_debit_code text,p_credit_code text,p_amount numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; dr uuid; cr uuid; existing public.journal_entries%rowtype; entry uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:telegram-binding',0));
  select user_id into owner_id from public.telegram_connections where chat_id = p_chat_id;
  if owner_id is null then return pg_catalog.jsonb_build_object('status','unlinked'); end if;
  if p_update_id is null or p_update_id < 0 or p_entry_type in ('opening','reversal') then raise exception 'Invalid update' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || owner_id::text,0));
  select * into existing from public.journal_entries where telegram_update_id = p_update_id;
  if found then return pg_catalog.jsonb_build_object('status',case when existing.user_id = owner_id then 'duplicate' else 'conflict' end); end if;
  if exists(select 1 from public.transactions where telegram_update_id = p_update_id) then return pg_catalog.jsonb_build_object('status','duplicate'); end if;
  select id into dr from public.ledger_accounts where user_id = owner_id and code = p_debit_code;
  select id into cr from public.ledger_accounts where user_id = owner_id and code = p_credit_code;
  if dr is null or cr is null then return pg_catalog.jsonb_build_object('status','invalid_account'); end if;
  entry := public._write_journal(owner_id,p_entry_date,p_memo,p_entry_type,p_category,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account_id',dr,'debit',p_amount,'credit',0),
      pg_catalog.jsonb_build_object('account_id',cr,'debit',0,'credit',p_amount)),'telegram',p_update_id => p_update_id);
  return pg_catalog.jsonb_build_object('status','posted','entry_id',entry);
end; $$;
revoke all on function public.post_telegram_journal(bigint,bigint,date,text,text,text,text,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.post_telegram_journal(bigint,bigint,date,text,text,text,text,text,numeric) to service_role;

notify pgrst,'reload schema';
commit;
