-- YuMeew 會員、額度與交易紀錄。
-- 請在 Supabase 專案執行此 migration；前端只具備讀取自己資料的權限。

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('topup', 'consumption', 'refund', 'adjustment')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  description text not null default '',
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists credit_ledger_reference_unique
  on public.credit_ledger (user_id, reference_id)
  where reference_id is not null;
create index if not exists credit_ledger_user_created_at
  on public.credit_ledger (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "members read own profile" on public.profiles;
create policy "members read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "members update own profile" on public.profiles;
create policy "members update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "members read own credit account" on public.credit_accounts;
create policy "members read own credit account" on public.credit_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "members read own credit ledger" on public.credit_ledger;
create policy "members read own credit ledger" on public.credit_ledger
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  ) on conflict (user_id) do nothing;
  insert into public.credit_accounts (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_member();

insert into public.profiles (user_id, display_name, avatar_url)
select id, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', ''),
       coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture')
from auth.users on conflict (user_id) do nothing;
insert into public.credit_accounts (user_id)
select id from auth.users on conflict (user_id) do nothing;

create or replace function public.record_credit_transaction(
  p_user_id uuid,
  p_kind text,
  p_amount bigint,
  p_description text default '',
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.credit_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_entry public.credit_ledger;
  new_balance bigint;
begin
  if p_kind not in ('topup', 'consumption', 'refund', 'adjustment') then
    raise exception 'Unsupported credit transaction kind';
  end if;
  if p_amount = 0
     or (p_kind in ('topup', 'refund') and p_amount < 0)
     or (p_kind = 'consumption' and p_amount > 0) then
    raise exception 'Invalid credit transaction amount';
  end if;
  if p_reference_id is not null then
    select * into current_entry from public.credit_ledger
      where user_id = p_user_id and reference_id = p_reference_id;
    if found then return current_entry; end if;
  end if;
  update public.credit_accounts
    set balance = balance + p_amount, updated_at = now()
    where user_id = p_user_id and balance + p_amount >= 0
    returning balance into new_balance;
  if not found then raise exception 'Member credit account not found or balance is insufficient'; end if;
  insert into public.credit_ledger (user_id, kind, amount, balance_after, description, reference_id, metadata)
    values (p_user_id, p_kind, p_amount, new_balance, coalesce(p_description, ''), p_reference_id, coalesce(p_metadata, '{}'::jsonb))
    returning * into current_entry;
  return current_entry;
end;
$$;

revoke all on function public.record_credit_transaction(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_credit_transaction(uuid, text, bigint, text, text, jsonb) to service_role;

comment on function public.record_credit_transaction(uuid, text, bigint, text, text, jsonb)
  is 'Atomically records top-ups and consumption. Call only from a trusted backend using service_role.';
