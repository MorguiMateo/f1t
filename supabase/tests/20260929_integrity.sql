-- Run against a locally migrated database with psql -v ON_ERROR_STOP=1 -f.
-- Catalog assertions need no auth fixtures and never change user data.
begin;

do $$
declare
  definition text;
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.routine_exercises'::regclass
       and conname = 'routine_exercises_day_exercise_key'
       and contype = 'u'
  ) then
    raise exception 'Missing one-exercise-per-day constraint';
  end if;

  select pg_get_constraintdef(oid) into definition
    from pg_constraint
   where conrelid = 'public.sessions'::regclass
     and conname = 'sessions_routine_day_owner_fk';
  if definition is null or
     definition not like '%FOREIGN KEY (routine_day_id, user_id)%' or
     definition not like '%ON DELETE SET NULL (routine_day_id)%' then
    raise exception 'Session/day owner FK does not preserve session ownership: %', definition;
  end if;

  if not has_function_privilege(
    'authenticated', 'public.activate_routine(uuid)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.swap_routine_exercise_positions(uuid,integer,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role cannot call routine RPCs';
  end if;

  if has_function_privilege(
    'anon', 'public.activate_routine(uuid)', 'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.swap_routine_exercise_positions(uuid,integer,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role can call a routine RPC';
  end if;

  if has_column_privilege(
    'authenticated', 'public.sessions', 'set_count', 'UPDATE'
  ) then
    raise exception 'Authenticated role can still directly update set_count';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.session_sets'::regclass
       and tgname = 'session_sets_no_move'
       and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.sessions'::regclass
       and tgname = 'sessions_empty_on_insert'
       and not tgisinternal
  ) then
    raise exception 'A session counter write guard is missing';
  end if;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.sync_session_set_count()'::regprocedure
       and prosecdef
       and prosrc like '%set_count + delta%'
  ) then
    raise exception 'Counter trigger is not using serialized delta updates';
  end if;
end;
$$;

rollback;
