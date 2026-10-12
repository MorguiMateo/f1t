-- Private diary. Catalog data stays in the offline bundle; these are user snapshots.
create table public.food_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  logged_on date not null,
  target_kcal numeric(8,2),
  tdee_kcal numeric(8,2),
  created_at timestamptz not null default now(),
  primary key (user_id, logged_on),
  constraint food_days_target_pair check ((target_kcal is null) = (tdee_kcal is null)),
  -- Permitted inputs: 400 kg, 260 cm, age 0, male -> BMR 5630;
  -- activity 1.9 -> TDEE 10697; gain +300 rounded to 50 -> 11000.
  -- The formula can yield nonpositive values for extreme old/low profiles;
  -- those are stored as a null pair instead of an invalid target.
  constraint food_days_target_range check (target_kcal is null or
    (target_kcal > 0 and target_kcal <= 11000 and
     tdee_kcal > 0 and tdee_kcal <= 11000))
);

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  logged_on date not null,
  created_at timestamptz not null default now(),
  catalog_version text not null,
  source text not null default 'OFF' check (source = 'OFF'),
  source_code text not null check (source_code ~ '^[0-9]{8,14}$'),
  source_revision bigint not null check (source_revision > 0),
  source_url text not null,
  source_retrieved_at timestamptz not null,
  source_response_sha256 text not null check (source_response_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at date not null,
  food_name text not null check (length(trim(food_name)) between 1 and 200),
  brand text not null check (length(trim(brand)) between 1 and 200),
  basis_unit text not null check (basis_unit in ('g', 'ml')),
  quantity numeric(8,2) not null check (quantity > 0 and quantity <= 5000),
  energy_kcal_per_100 numeric(18,12) not null check (energy_kcal_per_100 between 0 and 1000),
  kcal numeric(20,10) generated always as (quantity * energy_kcal_per_100 / 100) stored,
  constraint food_entries_day_fk foreign key (user_id, logged_on)
    references public.food_days (user_id, logged_on) on delete cascade
);
create index food_entries_day_idx on public.food_entries (user_id, logged_on, created_at, id);

alter table public.food_days enable row level security;
alter table public.food_entries enable row level security;
create policy food_days_own on public.food_days for select to authenticated
  using (user_id = (select auth.uid()));
create policy food_entries_own on public.food_entries for select to authenticated
  using (user_id = (select auth.uid()));

-- All writes go through RPCs: first log and day's estimate are one transaction,
-- and immutable product/energy snapshots cannot be edited by a later client.
revoke all on public.food_days, public.food_entries from public, anon, authenticated;
grant select on public.food_days, public.food_entries to authenticated;

create function public.log_food_entry(
  p_logged_on date, p_target_kcal numeric, p_tdee_kcal numeric,
  p_catalog_version text, p_source_code text, p_source_revision bigint,
  p_source_url text, p_source_retrieved_at timestamptz,
  p_source_response_sha256 text, p_reviewed_at date,
  p_food_name text, p_brand text, p_basis_unit text,
  p_quantity numeric, p_energy_kcal_per_100 numeric
)
returns public.food_entries
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved public.food_entries;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_logged_on is null or p_quantity is null or p_quantity <= 0 or p_quantity > 5000 or
     p_quantity <> round(p_quantity, 2) or p_energy_kcal_per_100 is null or
     p_energy_kcal_per_100 < 0 or p_energy_kcal_per_100 > 1000 then
    raise exception 'Invalid food quantity or energy.';
  end if;
  if (p_target_kcal is null) <> (p_tdee_kcal is null) then
    raise exception 'Target and TDEE must be supplied together.';
  end if;

  insert into public.food_days (user_id, logged_on, target_kcal, tdee_kcal)
    values (owner_id, p_logged_on, p_target_kcal, p_tdee_kcal)
    on conflict (user_id, logged_on) do nothing;

  insert into public.food_entries (
    user_id, logged_on, catalog_version, source_code, source_revision,
    source_url, source_retrieved_at, source_response_sha256, reviewed_at,
    food_name, brand, basis_unit, quantity, energy_kcal_per_100
  ) values (
    owner_id, p_logged_on, p_catalog_version, p_source_code, p_source_revision,
    p_source_url, p_source_retrieved_at, p_source_response_sha256, p_reviewed_at,
    p_food_name, p_brand, p_basis_unit, p_quantity, p_energy_kcal_per_100
  ) returning * into saved;
  return saved;
end;
$$;

create function public.set_food_entry_quantity(p_id uuid, p_quantity numeric)
returns public.food_entries
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved public.food_entries;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 5000 or
     p_quantity <> round(p_quantity, 2) then
    raise exception 'Invalid food quantity.';
  end if;
  update public.food_entries set quantity = p_quantity
    where id = p_id and user_id = owner_id returning * into saved;
  if saved.id is null then
    raise exception 'Food entry not found for this user.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

create function public.delete_food_entry(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  delete from public.food_entries where id = p_id and user_id = owner_id;
  if not found then
    raise exception 'Food entry not found for this user.' using errcode = 'P0002';
  end if;
  -- Deliberately retain food_days: deleting the last meal must not erase the
  -- first-log target snapshot or allow a later log to rewrite history.
end;
$$;

revoke all on function public.log_food_entry(date,numeric,numeric,text,text,bigint,text,timestamptz,text,date,text,text,text,numeric,numeric) from public, anon;
revoke all on function public.set_food_entry_quantity(uuid,numeric) from public, anon;
revoke all on function public.delete_food_entry(uuid) from public, anon;
grant execute on function public.log_food_entry(date,numeric,numeric,text,text,bigint,text,timestamptz,text,date,text,text,text,numeric,numeric) to authenticated;
grant execute on function public.set_food_entry_quantity(uuid,numeric) to authenticated;
grant execute on function public.delete_food_entry(uuid) to authenticated;
