create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  amount bigint not null check (amount > 0),
  category text not null,
  description text not null,
  transaction_date date not null,
  source text not null default 'web' check (source in ('web', 'telegram', 'receipt')),
  telegram_update_id bigint unique,
  receipt_storage_path text,
  created_at timestamptz not null default now()
);

create index transactions_user_date_idx
  on public.transactions (user_id, transaction_date desc);

alter table public.transactions enable row level security;

revoke all on table public.transactions from anon, authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;

create policy "Users can read their own transactions"
  on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add their own transactions"
  on public.transactions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own transactions"
  on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own transactions"
  on public.transactions for delete to authenticated
  using ((select auth.uid()) = user_id);

create table public.telegram_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  linked_at timestamptz not null default now()
);

alter table public.telegram_connections enable row level security;

-- Bot pairing and webhook code access this table only from the server.
revoke all on table public.telegram_connections from public, anon, authenticated;
grant all on table public.telegram_connections to service_role;

create table public.telegram_pairing_codes (
  code_hash text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.telegram_pairing_codes enable row level security;
revoke all on table public.telegram_pairing_codes from public, anon, authenticated;
grant all on table public.telegram_pairing_codes to service_role;

create or replace function public.redeem_telegram_pairing_code(p_code_hash text, p_chat_id bigint)
returns table (linked_user_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pairing public.telegram_pairing_codes%rowtype;
begin
  select * into pairing
    from public.telegram_pairing_codes
    where code_hash = p_code_hash
    for update;

  if not found or pairing.expires_at <= now() then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;

  insert into public.telegram_connections (user_id, chat_id)
    values (pairing.user_id, p_chat_id)
    on conflict (user_id) do update
      set chat_id = excluded.chat_id, linked_at = now();

  delete from public.telegram_pairing_codes where code_hash = p_code_hash;
  return query select pairing.user_id, 'linked'::text;
exception when unique_violation then
  return query select null::uuid, 'chat_in_use'::text;
end;
$$;

revoke all on function public.redeem_telegram_pairing_code(text, bigint) from public, anon, authenticated;
grant execute on function public.redeem_telegram_pairing_code(text, bigint) to service_role;

create table public.pending_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id bigint not null,
  telegram_update_id bigint not null unique,
  merchant text not null,
  amount bigint not null check (amount > 0),
  category text not null default 'Belanja',
  transaction_date date not null,
  date_was_defaulted boolean not null default false,
  confidence numeric(5, 2) not null check (confidence >= 0 and confidence <= 100),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.pending_receipts enable row level security;
revoke all on table public.pending_receipts from public, anon, authenticated;
grant all on table public.pending_receipts to service_role;

create or replace function public.confirm_pending_receipt(
  p_pending_receipt_id uuid,
  p_chat_id bigint
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  receipt public.pending_receipts%rowtype;
begin
  select * into receipt
    from public.pending_receipts
    where id = p_pending_receipt_id and chat_id = p_chat_id
    for update;

  if not found or receipt.expires_at <= now() then
    return 'invalid';
  end if;

  insert into public.transactions (
    user_id, kind, amount, category, description, transaction_date, source, telegram_update_id
  ) values (
    receipt.user_id, 'expense', receipt.amount, receipt.category, receipt.merchant,
    receipt.transaction_date, 'receipt', receipt.telegram_update_id
  ) on conflict (telegram_update_id) do nothing;

  delete from public.pending_receipts where id = receipt.id;
  return 'confirmed';
end;
$$;

revoke all on function public.confirm_pending_receipt(uuid, bigint) from public, anon, authenticated;
grant execute on function public.confirm_pending_receipt(uuid, bigint) to service_role;
