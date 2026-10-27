begin;

-- IDR amounts are whole rupiah, bounded to JavaScript's exact integer range.
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{3,12}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  role text not null default 'general' check (role in ('general','cash','bank','receivable','payable','credit_card','opening_equity')),
  created_at timestamptz not null default now(),
  unique(user_id, code), unique(id, user_id),
  check ((role in ('cash','bank','receivable') and account_type = 'asset')
    or (role in ('payable','credit_card') and account_type = 'liability')
    or (role = 'opening_equity' and account_type = 'equity') or role = 'general')
);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null check (entry_date between date '0001-01-01' and date '9999-12-31'),
  memo text not null check (length(btrim(memo)) between 1 and 240),
  entry_type text not null default 'journal' check (entry_type in
    ('income','expense','borrow','lend','repay_debt','collect_receivable','transfer','opening','journal','closing','reversal')),
  category text not null default 'Lainnya' check (length(category) between 1 and 60),
  source text not null check (source in ('web','telegram','receipt','migration')),
  telegram_update_id bigint unique,
  legacy_transaction_id uuid,
  request_id uuid,
  request_payload jsonb,
  reversal_of uuid references public.journal_entries(id),
  reversed_by uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  unique(id, user_id), unique(user_id, request_id), unique(reversal_of)
);
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null,
  account_id uuid not null,
  line_no integer not null check (line_no between 1 and 20),
  debit bigint not null default 0 check (debit between 0 and 9007199254740991),
  credit bigint not null default 0 check (credit between 0 and 9007199254740991),
  foreign key(entry_id,user_id) references public.journal_entries(id,user_id) on delete cascade,
  foreign key(account_id,user_id) references public.ledger_accounts(id,user_id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  unique(entry_id,line_no)
);
create index journal_entries_owner_date_idx on public.journal_entries(user_id,entry_date,created_at);
create index journal_lines_account_idx on public.journal_lines(user_id,account_id,entry_id);
create table public.legacy_ledger_links (
  transaction_id uuid primary key,
  entry_id uuid not null references public.journal_entries(id) on delete cascade
);

alter table public.ledger_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.legacy_ledger_links enable row level security;
revoke all on public.ledger_accounts,public.journal_entries,public.journal_lines,public.legacy_ledger_links from public,anon,authenticated,service_role;
grant select on public.ledger_accounts,public.journal_entries,public.journal_lines to authenticated,service_role;
create policy "Read own ledger accounts" on public.ledger_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own journal entries" on public.journal_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own journal lines" on public.journal_lines for select to authenticated using (user_id = (select auth.uid()));

-- Final defense: even a privileged accidental write cannot commit an unbalanced journal.
create function public._check_balanced_journal() returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; targets uuid[]; line_count integer; account_count integer; total_debit numeric; total_credit numeric;
begin
  if tg_table_name = 'journal_entries' then targets := array[new.id];
  elsif tg_op = 'DELETE' then targets := array[old.entry_id];
  elsif tg_op = 'UPDATE' then targets := array[old.entry_id,new.entry_id]; else targets := array[new.entry_id]; end if;
  foreach target in array targets loop
    if not exists (select 1 from public.journal_entries where id = target) then continue; end if;
    select count(*),count(distinct account_id),coalesce(sum(debit),0),coalesce(sum(credit),0)
      into line_count,account_count,total_debit,total_credit from public.journal_lines where entry_id = target;
    if line_count not between 2 and 20 or account_count < 2 or total_debit <> total_credit or total_debit <= 0 or total_debit > 9007199254740991 then
      raise exception 'Journal must have balanced debit and credit lines' using errcode = '23514';
    end if;
  end loop;
  return null;
end; $$;
revoke all on function public._check_balanced_journal() from public,anon,authenticated,service_role;
create constraint trigger balanced_journal_header after insert on public.journal_entries deferrable initially deferred
  for each row execute function public._check_balanced_journal();
create constraint trigger balanced_journal_lines after insert or update or delete on public.journal_lines deferrable initially deferred
  for each row execute function public._check_balanced_journal();

create function public._seed_ledger_accounts(p_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_accounts(user_id,code,name,account_type,role) values
    (p_user_id,'1000','Kas / Cash','asset','cash'),
    (p_user_id,'1010','Bank','asset','bank'),
    (p_user_id,'1100','Piutang / Receivables','asset','receivable'),
    (p_user_id,'2000','Utang / Payables','liability','payable'),
    (p_user_id,'2100','Kartu kredit / Credit card','liability','credit_card'),
    (p_user_id,'3000','Modal awal / Opening equity','equity','opening_equity'),
    (p_user_id,'4000','Pendapatan / Revenue','revenue','general'),
    (p_user_id,'5000','Beban / Expenses','expense','general') on conflict(user_id,code) do nothing;
end; $$;
revoke all on function public._seed_ledger_accounts(uuid) from public,anon,authenticated,service_role;

create function public._write_journal(
  p_user_id uuid,p_date date,p_memo text,p_type text,p_category text,p_lines jsonb,p_source text,
  p_legacy_id uuid default null,p_reversal_of uuid default null,p_update_id bigint default null,
  p_request_id uuid default null,p_payload jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare entry uuid; item jsonb; position integer := 0; total_debit numeric := 0; total_credit numeric := 0;
  line_debit bigint; line_credit bigint; target_account uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || p_user_id::text,0));
  if p_date is null or length(btrim(p_memo)) not between 1 and 240 or length(p_category) not between 1 and 60
    or pg_catalog.jsonb_typeof(p_lines) is distinct from 'array' or pg_catalog.jsonb_array_length(p_lines) not between 2 and 20 then
    raise exception 'Invalid journal' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_lines) loop
    if coalesce(item->>'debit','') !~ '^[0-9]{1,16}$' or coalesce(item->>'credit','') !~ '^[0-9]{1,16}$' then
      raise exception 'Use whole positive rupiah amounts' using errcode = '22023';
    end if;
    line_debit := (item->>'debit')::bigint; line_credit := (item->>'credit')::bigint;
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
      values(p_user_id,entry,(item->>'account_id')::uuid,position,(item->>'debit')::bigint,(item->>'credit')::bigint);
  end loop;
  return entry;
end; $$;
revoke all on function public._write_journal(uuid,date,text,text,text,jsonb,text,uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.post_journal(p_entry_date date,p_memo text,p_lines jsonb,
  p_entry_type text default 'journal',p_category text default 'Lainnya',p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); existing public.journal_entries%rowtype; payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_entry_type in ('opening','reversal') or p_entry_type is null then raise exception 'Use the dedicated posting action' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || owner_id::text,0));
  payload := pg_catalog.jsonb_build_object('date',p_entry_date,'memo',btrim(p_memo),'type',p_entry_type,'category',p_category,'lines',p_lines);
  if p_request_id is not null then
    select * into existing from public.journal_entries where user_id = owner_id and request_id = p_request_id;
    if found then
      if existing.request_payload is distinct from payload then raise exception 'Request already used for a different journal' using errcode = '22023'; end if;
      return existing.id;
    end if;
  end if;
  return public._write_journal(owner_id,p_entry_date,p_memo,p_entry_type,p_category,p_lines,'web',
    p_request_id => p_request_id,p_payload => payload);
end; $$;
revoke all on function public.post_journal(date,text,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.post_journal(date,text,jsonb,text,text,uuid) to authenticated;

create function public._reverse_journal(p_owner uuid,p_entry_id uuid,p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare original public.journal_entries%rowtype; reverse_lines jsonb; reversal uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || p_owner::text,0));
  select * into original from public.journal_entries where id = p_entry_id and user_id = p_owner for update;
  if not found then raise exception 'Journal is unavailable' using errcode = '42501'; end if;
  if original.reversed_by is not null then return original.reversed_by; end if;
  if original.reversal_of is not null or p_date < original.entry_date then raise exception 'Invalid reversal date or journal' using errcode = '22023'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('account_id',account_id,'debit',credit,'credit',debit) order by line_no)
    into reverse_lines from public.journal_lines where entry_id = original.id;
  reversal := public._write_journal(p_owner,p_date,left('Reversal: ' || original.memo,240),'reversal',original.category,reverse_lines,'web',p_reversal_of => original.id);
  update public.journal_entries set reversed_by = reversal where id = original.id;
  return reversal;
end; $$;
revoke all on function public._reverse_journal(uuid,uuid,date) from public,anon,authenticated,service_role;
create function public.reverse_journal(p_entry_id uuid,p_entry_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return public._reverse_journal(auth.uid(),p_entry_id,p_entry_date);
end; $$;
revoke all on function public.reverse_journal(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.reverse_journal(uuid,date) to authenticated;

create function public.record_opening_balance(p_account_id uuid,p_amount bigint,p_entry_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); account public.ledger_accounts%rowtype; prior public.journal_entries%rowtype;
  prior_amount bigint; equity uuid; dr uuid; cr uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || owner_id::text,0));
  select * into account from public.ledger_accounts where id = p_account_id and user_id = owner_id;
  if not found then raise exception 'Account is unavailable' using errcode = '42501'; end if;
  if account.account_type not in ('asset','liability') or p_amount is null or p_amount = 0 or abs(p_amount::numeric) > 9007199254740991 then
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
revoke all on function public.record_opening_balance(uuid,bigint,date) from public,anon,authenticated,service_role;
grant execute on function public.record_opening_balance(uuid,bigint,date) to authenticated;

create function public.create_ledger_account(p_code text,p_name text,p_account_type text,p_role text default 'general',
  p_opening_balance bigint default 0,p_opening_date date default current_date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); account uuid; equity uuid; debit_account uuid; credit_account uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_role = 'opening_equity' or p_opening_balance is null or abs(p_opening_balance::numeric) > 9007199254740991
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
revoke all on function public.create_ledger_account(text,text,text,text,bigint,date) from public,anon,authenticated,service_role;
grant execute on function public.create_ledger_account(text,text,text,text,bigint,date) to authenticated;

-- Preserve the existing web, receipt, and bot endpoints. Older entries become journals;
-- subsequent edits/deletes append reversals instead of erasing accounting history.
create function public._sync_legacy_transaction() returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; previous uuid; new_entry uuid; cash uuid; revenue uuid; expense uuid; dr uuid; cr uuid;
begin
  if tg_op = 'DELETE' then owner_id := old.user_id; else owner_id := new.user_id; end if;
  -- During an auth.users cascade the owner's accounts are also being removed.
  if not exists(select 1 from auth.users where id = owner_id) then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saku:ledger:' || owner_id::text,0));
  if tg_op <> 'INSERT' then
    select entry_id into previous from public.legacy_ledger_links where transaction_id = old.id;
    if previous is not null then
      if exists(select 1 from public.journal_entries where id = previous and reversed_by is not null) then
        raise exception 'Journal was already reversed; post a new journal instead' using errcode = '22023'; end if;
      perform public._reverse_journal(owner_id,previous,old.transaction_date);
    end if;
    delete from public.legacy_ledger_links where transaction_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  perform public._seed_ledger_accounts(owner_id);
  select id into cash from public.ledger_accounts where user_id = owner_id and code = '1000';
  select id into revenue from public.ledger_accounts where user_id = owner_id and code = '4000';
  select id into expense from public.ledger_accounts where user_id = owner_id and code = '5000';
  if new.kind = 'income' then dr := cash; cr := revenue; else dr := expense; cr := cash; end if;
  new_entry := public._write_journal(owner_id,new.transaction_date,new.description,new.kind,new.category,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account_id',dr,'debit',new.amount,'credit',0),
      pg_catalog.jsonb_build_object('account_id',cr,'debit',0,'credit',new.amount)),new.source,p_legacy_id => new.id,
      p_update_id => case when tg_op = 'INSERT' then new.telegram_update_id else null end);
  insert into public.legacy_ledger_links(transaction_id,entry_id) values(new.id,new_entry);
  return new;
end; $$;
revoke all on function public._sync_legacy_transaction() from public,anon,authenticated,service_role;
create trigger sync_transaction_ledger after insert or delete or update of kind,amount,category,description,transaction_date
  on public.transactions for each row execute function public._sync_legacy_transaction();

create function public._initialize_user_ledger() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public._seed_ledger_accounts(new.id); return new; end; $$;
revoke all on function public._initialize_user_ledger() from public,anon,authenticated,service_role;
create trigger initialize_user_ledger after insert on auth.users for each row execute function public._initialize_user_ledger();

do $$
declare owner record; item public.transactions%rowtype; cash uuid; revenue uuid; expense uuid; entry uuid;
begin
  for owner in select id from auth.users loop perform public._seed_ledger_accounts(owner.id); end loop;
  for item in select * from public.transactions order by created_at,id loop
    select id into cash from public.ledger_accounts where user_id = item.user_id and code = '1000';
    select id into revenue from public.ledger_accounts where user_id = item.user_id and code = '4000';
    select id into expense from public.ledger_accounts where user_id = item.user_id and code = '5000';
    entry := public._write_journal(item.user_id,item.transaction_date,item.description,item.kind,item.category,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account_id',case when item.kind = 'income' then cash else expense end,'debit',item.amount,'credit',0),
        pg_catalog.jsonb_build_object('account_id',case when item.kind = 'income' then revenue else cash end,'debit',0,'credit',item.amount)),item.source,p_legacy_id => item.id,p_update_id => item.telegram_update_id);
    insert into public.legacy_ledger_links(transaction_id,entry_id) values(item.id,entry);
  end loop;
end; $$;

create function public.post_telegram_journal(p_chat_id bigint,p_update_id bigint,p_entry_date date,p_memo text,p_entry_type text,
  p_category text,p_debit_code text,p_credit_code text,p_amount bigint) returns jsonb
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
revoke all on function public.post_telegram_journal(bigint,bigint,date,text,text,text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.post_telegram_journal(bigint,bigint,date,text,text,text,text,text,bigint) to service_role;

create function public.telegram_ledger_summary(p_chat_id bigint,p_start_date date,p_end_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with owner as (select user_id from public.telegram_connections where chat_id = p_chat_id),
  balances as (
    select a.id,a.code,a.name,a.account_type,a.role,coalesce(sum(l.debit),0) as debit,coalesce(sum(l.credit),0) as credit
    from public.ledger_accounts a join owner o on o.user_id = a.user_id
    left join public.journal_lines l on l.account_id = a.id group by a.id
  ), period as (
    select e.id,
      coalesce(sum(case when a.account_type = 'revenue' and e.entry_type <> 'closing' and coalesce(original.entry_type,'') <> 'closing' then l.credit-l.debit else 0 end),0) as income,
      coalesce(sum(case when a.account_type = 'expense' and e.entry_type <> 'closing' and coalesce(original.entry_type,'') <> 'closing' then l.debit-l.credit else 0 end),0) as expense,
      coalesce(sum(case when a.role in ('cash','bank') and e.entry_type <> 'opening' and coalesce(original.entry_type,'') <> 'opening' then l.debit-l.credit else 0 end),0) as cash
    from public.journal_entries e join owner o on o.user_id = e.user_id
    join public.journal_lines l on l.entry_id = e.id join public.ledger_accounts a on a.id = l.account_id
    left join public.journal_entries original on original.id = e.reversal_of
    where e.entry_date >= p_start_date and e.entry_date < p_end_date group by e.id
  ) select case when exists(select 1 from owner) then pg_catalog.jsonb_build_object(
    'income',coalesce((select sum(income) from period),0)::text, 'expense',coalesce((select sum(expense) from period),0)::text,
    'cash_in',coalesce((select sum(greatest(cash,0)) from period),0)::text,'cash_out',coalesce((select sum(greatest(-cash,0)) from period),0)::text,
    'accounts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code',code,'name',name,'account_type',account_type,'role',role,
      'balance',(case when account_type in ('asset','expense') then debit-credit else credit-debit end)::text) order by code) from balances),'[]'::jsonb)
  ) else null end;
$$;
revoke all on function public.telegram_ledger_summary(bigint,date,date) from public,anon,authenticated,service_role;
grant execute on function public.telegram_ledger_summary(bigint,date,date) to service_role;

notify pgrst,'reload schema';
commit;
