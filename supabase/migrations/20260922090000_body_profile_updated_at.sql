-- ============================================================================
-- F1t — the database owns `body_profile.updated_at` and its ranges (Phase 5.1)
--
-- The column was born with `default now()`, and a default only fires on
-- INSERT. `body_profile` has one row per user and is written with an upsert,
-- so from the second save on the row is an UPDATE and the timestamp would
-- stay frozen at the day the profile was created — a column that looks like
-- an answer and isn't.
--
-- Same reasoning as `sessions.set_count` in Phase 4: if a value's truth can
-- be derived from the write itself, the database derives it. A client that
-- sends its own `now()` is a client that can be wrong about what time it is,
-- and every other writer — the SQL console, the native shell of Phase 6 —
-- would have to remember to send it too.
--
-- This migration also adds the range guards §3 left out. `height_cm` had one
-- from day one; `target_weight_kg` and `birth_date` did not, so a typo could
-- store a four-kilo goal or a birthday in 2098 and the TDEE of Phase 5.4
-- would compute something plausible out of it.
-- ============================================================================

-- `security invoker` with an empty `search_path`, for the same reasons as
-- `sync_session_set_count`: the trigger runs as whoever wrote the row, under
-- that user's policy, and every name it touches is schema-qualified.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- BEFORE UPDATE: the row this returns is the one that gets written, so the
-- timestamp lands inside the same statement instead of a second UPDATE.
drop trigger if exists body_profile_touch_updated_at on public.body_profile;
create trigger body_profile_touch_updated_at
  before update on public.body_profile
  for each row execute function public.touch_updated_at();

-- The same range the `weight_entries` check already uses. A target weight and
-- a measured weight are the same magnitude: two different bounds for it is
-- how you end up with a goal you can type and can never log.
alter table public.body_profile
  drop constraint if exists body_profile_target_weight_check;
alter table public.body_profile
  add constraint body_profile_target_weight_check
  check (target_weight_kg is null or target_weight_kg between 20 and 400);

-- The lower bound goes in a CHECK because 1900 is a constant. "Not in the
-- future" cannot: `current_date` is not immutable, and a CHECK that depends
-- on the clock is a table that may refuse to restore from its own dump. The
-- trigger below is the Postgres idiom for a rule that moves with time.
alter table public.body_profile
  drop constraint if exists body_profile_birth_date_check;
alter table public.body_profile
  add constraint body_profile_birth_date_check
  check (birth_date is null or birth_date >= date '1900-01-01');

create or replace function public.check_birth_date_not_future()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise check_violation using
      message = 'La fecha de nacimiento no puede estar en el futuro.',
      constraint = 'body_profile_birth_date_check';
  end if;
  return new;
end;
$$;

drop trigger if exists body_profile_birth_date_not_future on public.body_profile;
create trigger body_profile_birth_date_not_future
  before insert or update on public.body_profile
  for each row execute function public.check_birth_date_not_future();
