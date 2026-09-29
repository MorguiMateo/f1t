-- Close the data-contract gaps found in the implemented routines and sessions.
-- This migration deliberately aborts on ambiguous existing data. Resolve the
-- reported rows manually before retrying; never discard a user's history here.

do $$
declare
  duplicate record;
  foreign_day record;
begin
  select routine_day_id, exercise_id, count(*) as copies
    into duplicate
    from public.routine_exercises
   group by routine_day_id, exercise_id
  having count(*) > 1
   limit 1;

  if found then
    raise exception
      'Duplicate routine exercise: day %, exercise %, % rows. Resolve duplicates before applying this migration.',
      duplicate.routine_day_id, duplicate.exercise_id, duplicate.copies;
  end if;

  select s.id, s.user_id as session_owner, d.user_id as day_owner
    into foreign_day
    from public.sessions s
    join public.routine_days d on d.id = s.routine_day_id
   where s.user_id <> d.user_id
   limit 1;

  if found then
    raise exception
      'Session % belongs to %, but its routine day belongs to %. Resolve this link before applying this migration.',
      foreign_day.id, foreign_day.session_owner, foreign_day.day_owner;
  end if;
end;
$$;

alter table public.routine_exercises
  add constraint routine_exercises_day_exercise_key
  unique (routine_day_id, exercise_id);

-- Keep the session and its sets when a routine day is deleted. Only the day
-- reference becomes null; the non-null owner remains available to RLS.
alter table public.sessions
  drop constraint sessions_routine_day_id_fkey;
alter table public.sessions
  add constraint sessions_routine_day_owner_fk
  foreign key (routine_day_id, user_id)
  references public.routine_days (id, user_id)
  on delete set null (routine_day_id);

-- A single RPC call is one transaction. Locking all of this user's routines
-- in a stable order serializes competing activations from multiple devices.
create function public.activate_routine(p_routine_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  changed integer;
begin
  if owner_id is null then
    raise exception 'Authentication required to activate a routine.'
      using errcode = '42501';
  end if;

  perform 1
    from public.routines
   where user_id = owner_id
   order by id
   for update;

  if not exists (
    select 1 from public.routines
     where id = p_routine_id and user_id = owner_id
  ) then
    raise exception 'Routine not found for this user.'
      using errcode = 'P0002';
  end if;

  -- The partial unique index forbids activating the target before the old
  -- active row is cleared. A later failure rolls both statements back.
  update public.routines
     set is_active = false
   where user_id = owner_id and is_active;

  update public.routines
     set is_active = true
   where id = p_routine_id and user_id = owner_id;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Routine activation did not update exactly one row.';
  end if;
end;
$$;

revoke all on function public.activate_routine(uuid) from public;
grant execute on function public.activate_routine(uuid) to authenticated;

-- Compare the positions supplied by the screen with locked current values so
-- an old tab cannot exchange an unrelated order. One UPDATE changes both rows.
create function public.swap_routine_exercise_positions(
  p_a_id uuid,
  p_a_position integer,
  p_b_id uuid,
  p_b_position integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  first_row public.routine_exercises%rowtype;
  second_row public.routine_exercises%rowtype;
  changed integer;
begin
  if owner_id is null then
    raise exception 'Authentication required to reorder exercises.'
      using errcode = '42501';
  end if;
  if p_a_id is null or p_b_id is null or p_a_id = p_b_id then
    raise exception 'Two distinct exercise rows are required.';
  end if;

  perform 1
    from public.routine_exercises
   where id in (p_a_id, p_b_id) and user_id = owner_id
   order by id
   for update;

  select * into first_row from public.routine_exercises
   where id = p_a_id and user_id = owner_id;
  select * into second_row from public.routine_exercises
   where id = p_b_id and user_id = owner_id;

  if first_row.id is null or second_row.id is null or
     first_row.routine_day_id <> second_row.routine_day_id then
    raise exception 'Exercises must belong to the same owned routine day.'
      using errcode = 'P0002';
  end if;
  if first_row.position <> p_a_position or
     second_row.position <> p_b_position or
     first_row.position = second_row.position then
    raise exception 'Exercise order changed; reload the day before retrying.';
  end if;

  update public.routine_exercises
     set position = case id
       when p_a_id then second_row.position
       else first_row.position
     end
   where id in (p_a_id, p_b_id) and user_id = owner_id;
  get diagnostics changed = row_count;
  if changed <> 2 then
    raise exception 'Exercise swap did not update exactly two rows.';
  end if;
end;
$$;

revoke all on function public.swap_routine_exercise_positions(uuid, integer, uuid, integer) from public;
grant execute on function public.swap_routine_exercise_positions(uuid, integer, uuid, integer) to authenticated;

-- Session ownership is already enforced by RLS and the composite set FK.
-- The definer only updates the matching parent row; it cannot write a sibling
-- user's counter. Arithmetic on the locked parent row is safe under concurrent
-- inserts/deletes, unlike recounting from an MVCC snapshot in each trigger.
create or replace function public.sync_session_set_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
  target_owner uuid;
  delta integer;
begin
  if tg_op = 'INSERT' then
    target_session := new.session_id;
    target_owner := new.user_id;
    delta := 1;
  elsif tg_op = 'DELETE' then
    target_session := old.session_id;
    target_owner := old.user_id;
    delta := -1;
  else
    raise exception 'Unsupported session set count operation: %', tg_op;
  end if;

  update public.sessions
     set set_count = set_count + delta
   where id = target_session and user_id = target_owner;

  -- A parent being deleted by a cascade is already gone; zero rows is normal.
  if tg_op = 'INSERT' and not found then
    raise exception 'Session not found while adding a set.';
  end if;
  return null;
end;
$$;

revoke all on function public.sync_session_set_count() from public;

-- A set never moves between sessions. Reps, weight and index may still change
-- without affecting the number of sets in that session.
create function public.reject_session_set_move()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id or
     new.user_id is distinct from old.user_id then
    raise exception 'Moving a set between sessions is not supported.';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_session_set_move() from public;
create trigger session_sets_no_move
  before update on public.session_sets
  for each row execute function public.reject_session_set_move();

-- A new session starts empty. The only subsequent counter writes come from
-- the definer trigger above: authenticated clients no longer have UPDATE on
-- sessions. This app has no other session UPDATE operation.
create function public.require_empty_session_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.set_count <> 0 then
    raise exception 'Session set_count is maintained by the database.';
  end if;
  return new;
end;
$$;

revoke all on function public.require_empty_session_insert() from public;
create trigger sessions_empty_on_insert
  before insert on public.sessions
  for each row execute function public.require_empty_session_insert();

revoke update on public.sessions from public, anon, authenticated;

-- Repair any historical drift before the new delta trigger starts serving
-- writes. Apply this migration in its normal single transaction so writes
-- cannot interleave with this backfill.
update public.sessions s
   set set_count = (
     select count(*) from public.session_sets ss where ss.session_id = s.id
   )
 where s.set_count is distinct from (
     select count(*) from public.session_sets ss where ss.session_id = s.id
   );
