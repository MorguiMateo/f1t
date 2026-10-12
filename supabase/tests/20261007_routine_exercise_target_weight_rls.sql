-- Local migrated DB only, as postgres, with two auth.users fixtures. All writes roll back.
\set ON_ERROR_STOP on
begin;
select id as weight_user_a from auth.users order by id limit 1 \gset
select id as weight_user_b from auth.users order by id offset 1 limit 1 \gset

insert into public.exercises (id, name, category, level)
values ('__target_weight_fixture__', 'Weight fixture', 'strength', 'beginner');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'weight_user_a', true);
insert into public.routines (name) values ('Weight fixture') returning id as weight_routine \gset
insert into public.routine_days (routine_id, weekday, label)
values (:'weight_routine', 1, 'Weight fixture') returning id as weight_day \gset
insert into public.routine_exercises (routine_day_id, exercise_id, position)
values (:'weight_day', '__target_weight_fixture__', 0) returning id as weight_item \gset
insert into public.sessions (routine_day_id, performed_on)
values (:'weight_day', '2099-01-01') returning id as weight_session \gset
insert into public.session_sets (session_id, exercise_id, set_index, reps, weight_kg)
values (:'weight_session', '__target_weight_fixture__', 0, 8, 20);

update public.routine_exercises set target_weight_kg = 62.5 where id = :'weight_item';
do $$ begin
  if (select target_weight_kg from public.routine_exercises where exercise_id = '__target_weight_fixture__') <> 62.5 then
    raise exception 'Decimal default did not persist';
  end if;
  begin
    update public.routine_exercises set target_weight_kg = -1 where exercise_id = '__target_weight_fixture__';
    raise exception 'Negative default unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;

-- Learning from a stale workout must not override an explicit default.
update public.routine_exercises set target_weight_kg = 70 where id = :'weight_item' and target_weight_kg is null;
do $$ begin
  if (select target_weight_kg from public.routine_exercises where exercise_id = '__target_weight_fixture__') <> 62.5 then
    raise exception 'Learning overwrote an explicit default';
  end if;
end $$;
update public.routine_exercises set target_weight_kg = null where id = :'weight_item';
update public.routine_exercises set target_weight_kg = 0 where id = :'weight_item' and target_weight_kg is null;

select set_config('request.jwt.claim.sub', :'weight_user_b', true);
do $$ declare affected int; begin
  if exists (select 1 from public.routine_exercises where exercise_id = '__target_weight_fixture__') then
    raise exception 'Foreign routine weight was visible';
  end if;
  update public.routine_exercises set target_weight_kg = 99 where exercise_id = '__target_weight_fixture__';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Foreign weight was updated'; end if;
end $$;
select set_config('request.jwt.claim.sub', :'weight_user_a', true);
do $$ begin
  if (select target_weight_kg from public.routine_exercises where exercise_id = '__target_weight_fixture__') <> 0 then
    raise exception 'Zero default was lost';
  end if;
  if (select weight_kg from public.session_sets where exercise_id = '__target_weight_fixture__') <> 20 then
    raise exception 'Changing defaults rewrote a saved set';
  end if;
end $$;
update public.routine_exercises set target_weight_kg = null where id = :'weight_item';
do $$ begin
  if exists (select 1 from public.routine_exercises where exercise_id = '__target_weight_fixture__' and target_weight_kg is not null) then
    raise exception 'Clearing a weight did not persist null';
  end if;
end $$;
rollback;
