-- Apply migrations locally, then run psql -v ON_ERROR_STOP=1 -f this file.
-- No fixtures required; catalog/privilege assertions do not change user data.
begin;

do $$
declare
  policy_count integer;
  definition text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.food_days'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.food_entries'::regclass) then
    raise exception 'Food diary tables must have RLS enabled';
  end if;

  select count(*) into policy_count from pg_policies
   where schemaname = 'public' and tablename in ('food_days', 'food_entries')
     and cmd = 'SELECT' and roles = array['authenticated']::name[]
     and qual like '%auth.uid%';
  if policy_count <> 2 then
    raise exception 'Food day and entry select policies must be per-user';
  end if;

  if has_table_privilege('anon', 'public.food_entries', 'SELECT')
     or has_table_privilege('authenticated', 'public.food_entries', 'INSERT')
     or has_table_privilege('authenticated', 'public.food_entries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.food_entries', 'DELETE')
     or has_table_privilege('authenticated', 'public.food_days', 'INSERT')
     or has_table_privilege('authenticated', 'public.food_days', 'UPDATE')
     or has_table_privilege('authenticated', 'public.food_days', 'DELETE') then
    raise exception 'Food diary direct write or anonymous privileges are too broad';
  end if;

  if not has_function_privilege('authenticated', 'public.log_food_entry(date,numeric,numeric,text,text,bigint,text,timestamptz,text,date,text,text,text,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.log_food_entry(date,numeric,numeric,text,text,bigint,text,timestamptz,text,date,text,text,text,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_food_entry_quantity(uuid,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_food_entry(uuid)', 'EXECUTE') then
    raise exception 'Food diary RPC grants are incorrect';
  end if;

  select pg_get_constraintdef(oid) into definition from pg_constraint
   where conrelid = 'public.food_entries'::regclass and conname = 'food_entries_day_fk';
  if definition is null or definition not like '%FOREIGN KEY (user_id, logged_on)%' then
    raise exception 'Food entry/day ownership FK missing: %', definition;
  end if;

  if not exists (select 1 from pg_attribute where attrelid = 'public.food_entries'::regclass
      and attname = 'kcal' and attgenerated = 's') then
    raise exception 'Entry kcal must be database-generated';
  end if;

  select pg_get_constraintdef(oid) into definition from pg_constraint
   where conrelid = 'public.food_days'::regclass and conname = 'food_days_target_range';
  if definition is null or definition not like '%11000%' then
    raise exception 'Snapshot constraint excludes maximum valid formula output: %', definition;
  end if;
end;
$$;

rollback;
