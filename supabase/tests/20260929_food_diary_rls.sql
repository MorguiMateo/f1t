-- Run with psql -v ON_ERROR_STOP=1 against a migrated local database as postgres.
-- Requires two auth.users fixtures; rolls back every food write. Never run as a client role.
\set ON_ERROR_STOP on
begin;

select id as food_user_a from auth.users order by id limit 1 \gset
select id as food_user_b from auth.users order by id offset 1 limit 1 \gset

create function pg_temp.expect_foreign_food_denied(p_id uuid)
returns void language plpgsql security invoker as $$
begin
  begin
    perform public.set_food_entry_quantity(p_id, 50);
    raise exception 'Cross-user food update unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.delete_food_entry(p_id);
    raise exception 'Cross-user food delete unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;
grant execute on function pg_temp.expect_foreign_food_denied(uuid) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'food_user_a', true);
select (public.log_food_entry(
  date '2099-01-01', 11000, 10697, 'v1', '7790040123717', 26,
  'https://world.openfoodfacts.org/product/7790040123717',
  '2026-09-29T15:38:24Z', repeat('a',64), date '2026-09-29',
  'Historical product', 'Brand', 'g', 125.50, 830.769230769231
)).id as food_entry_a \gset
select (public.log_food_entry(
  date '2099-01-01', 1800, 2300, 'v2', '7790040123717', 26,
  'https://world.openfoodfacts.org/product/7790040123717',
  '2026-09-29T15:38:24Z', repeat('a',64), date '2026-09-29',
  'Historical product', 'Brand', 'g', 10, 830.769230769231
)).id as food_entry_a2 \gset

do $$
begin
  if (select count(*) from public.food_entries) <> 2 or
     (select count(*) from public.food_days) <> 1 or
     (select target_kcal from public.food_days where logged_on = date '2099-01-01') <> 11000 or
     (select tdee_kcal from public.food_days where logged_on = date '2099-01-01') <> 10697 or
     (select kcal from public.food_entries where quantity = 125.50) <> 1042.6153846154 then
    raise exception 'First-log snapshot, high bound, or database kcal calculation drifted';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'food_user_b', true);
do $$
begin
  if exists (select 1 from public.food_entries) or exists (select 1 from public.food_days) then
    raise exception 'Second user can read first user food rows';
  end if;
end;
$$;
select pg_temp.expect_foreign_food_denied(:'food_entry_a'::uuid);
select (public.log_food_entry(
  date '2099-01-01', null, null, 'v1', '7790040123717', 26,
  'https://world.openfoodfacts.org/product/7790040123717',
  '2026-09-29T15:38:24Z', repeat('a',64), date '2026-09-29',
  'Own product', 'Brand', 'ml', 100, 42
)).id as food_entry_b \gset

do $$
begin
  if (select count(*) from public.food_entries) <> 1 or
     (select target_kcal from public.food_days where logged_on = date '2099-01-01') is not null then
    raise exception 'Second user cannot keep an independent null-target diary';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'food_user_a', true);
select public.delete_food_entry(:'food_entry_a'::uuid);
select public.delete_food_entry(:'food_entry_a2'::uuid);
do $$
begin
  if exists (select 1 from public.food_entries) or
     (select target_kcal from public.food_days where logged_on = date '2099-01-01') <> 11000 then
    raise exception 'Deleting last meal erased the first-log energy snapshot';
  end if;
end;
$$;
rollback;
