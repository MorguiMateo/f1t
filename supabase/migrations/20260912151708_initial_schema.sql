-- ============================================================================
-- F1t — initial schema (PLAN.md §3)
--
-- Two rules that run through the whole file:
--
--   1. RLS on EVERY table holding user data. The anon key is public by
--      design: the only thing separating your data from anyone else's is the
--      policy.
--   2. Every user table carries its own `user_id`, child tables included.
--      That way the policy is a direct `user_id = auth.uid()`, with no
--      per-row subqueries. Composite FKs protect child ownership; the initial
--      sessions -> routine_days exception is closed by the 20260929 migration.
--
-- `(select auth.uid())` is used and not bare `auth.uid()`: in parentheses
-- Postgres evaluates it once per query (an initplan) instead of once per row.
-- Over thousands of rows the difference is large.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- exercises — global catalog, no user_id, read-only.
-- Populated by the seed scripts/fetch-exercises.mjs generates (Phase 2).
-- The id is free-exercise-db's slug ("Barbell_Full_Squat").
-- ---------------------------------------------------------------------------
create table if not exists public.exercises (
  id                 text primary key,
  name               text        not null,
  category           text        not null,
  equipment          text,
  level              text        not null,
  force              text,
  mechanic           text,
  primary_muscles    text[]      not null default '{}',
  secondary_muscles  text[]      not null default '{}',
  instructions       text[]      not null default '{}',
  images             text[]      not null default '{}',

  -- Closed vocabularies, verified against the dataset (PLAN.md §2).
  constraint exercises_category_check check (category in (
    'strength', 'stretching', 'plyometrics', 'strongman',
    'powerlifting', 'cardio', 'olympic weightlifting'
  )),
  constraint exercises_level_check check (level in (
    'beginner', 'intermediate', 'expert'
  )),
  constraint exercises_force_check check (force is null or force in (
    'pull', 'push', 'static'
  )),
  constraint exercises_mechanic_check check (mechanic is null or mechanic in (
    'compound', 'isolation'
  ))
);

comment on table public.exercises is
  'Catálogo derivado de free-exercise-db (Unlicense). Global y de solo lectura.';

-- ---------------------------------------------------------------------------
-- routines
-- ---------------------------------------------------------------------------
create table if not exists public.routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),

  -- routine_days' composite FK needs this.
  constraint routines_id_user_key unique (id, user_id)
);

create index if not exists routines_user_idx on public.routines (user_id);

-- One active routine per user. Partial: the false rows don't compete.
create unique index if not exists routines_one_active_idx
  on public.routines (user_id) where is_active;

-- ---------------------------------------------------------------------------
-- routine_days — a day with no row = rest. weekday 0 = Sunday.
-- ---------------------------------------------------------------------------
create table if not exists public.routine_days (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  routine_id  uuid not null,
  weekday     smallint not null,
  label       text not null,

  constraint routine_days_weekday_check check (weekday between 0 and 6),
  constraint routine_days_routine_fk foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete cascade,
  constraint routine_days_unique_weekday unique (routine_id, weekday),
  constraint routine_days_id_user_key unique (id, user_id)
);

create index if not exists routine_days_routine_idx
  on public.routine_days (routine_id, weekday);

-- ---------------------------------------------------------------------------
-- routine_exercises
-- ---------------------------------------------------------------------------
create table if not exists public.routine_exercises (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  routine_day_id   uuid not null,
  exercise_id      text not null references public.exercises on delete restrict,
  position         smallint not null default 0,
  target_sets      smallint,
  target_reps      text,
  notes            text,

  constraint routine_exercises_sets_check
    check (target_sets is null or target_sets between 1 and 50),
  constraint routine_exercises_day_fk foreign key (routine_day_id, user_id)
    references public.routine_days (id, user_id) on delete cascade
);

create index if not exists routine_exercises_day_idx
  on public.routine_exercises (routine_day_id, position);

-- ---------------------------------------------------------------------------
-- sessions — one workout per day.
--
-- ⚠ INVARIANT (PLAN.md §5.2): `performed_on` and `set_count` are exactly what
--   HeatmapSession consumes in src/lib/heatmap.ts. Do not rename without
--   changing the heatmap and, later on, the SwiftUI widget.
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  performed_on     date not null default current_date,
  -- The routine gets deleted but the history stays: set null, not cascade.
  routine_day_id   uuid references public.routine_days on delete set null,
  set_count        integer not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),

  constraint sessions_set_count_check check (set_count >= 0),
  -- What the heatmap assumes: one row per day.
  constraint sessions_one_per_day unique (user_id, performed_on),
  constraint sessions_id_user_key unique (id, user_id)
);

-- The heatmap asks for a user's date range: this index is that query.
create index if not exists sessions_user_date_idx
  on public.sessions (user_id, performed_on desc);

-- ---------------------------------------------------------------------------
-- session_sets — the set-by-set detail.
-- ---------------------------------------------------------------------------
create table if not exists public.session_sets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  session_id   uuid not null,
  exercise_id  text not null references public.exercises on delete restrict,
  set_index    smallint not null,
  reps         smallint,
  weight_kg    numeric(6, 2),

  constraint session_sets_reps_check check (reps is null or reps >= 0),
  constraint session_sets_weight_check check (weight_kg is null or weight_kg >= 0),
  constraint session_sets_session_fk foreign key (session_id, user_id)
    references public.sessions (id, user_id) on delete cascade,
  constraint session_sets_unique_index unique (session_id, exercise_id, set_index)
);

create index if not exists session_sets_session_idx
  on public.session_sets (session_id);

-- For the future per-exercise progression chart.
create index if not exists session_sets_exercise_idx
  on public.session_sets (user_id, exercise_id);

-- ---------------------------------------------------------------------------
-- body_profile — one row per user.
-- `sex` is what Mifflin-St Jeor needs to estimate TDEE (Phase 5).
-- ---------------------------------------------------------------------------
create table if not exists public.body_profile (
  user_id          uuid primary key default auth.uid() references auth.users on delete cascade,
  height_cm        smallint,
  birth_date       date,
  sex              text,
  goal             text not null default 'maintain',
  target_weight_kg numeric(5, 2),
  updated_at       timestamptz not null default now(),

  constraint body_profile_goal_check check (goal in ('lose', 'gain', 'maintain')),
  constraint body_profile_sex_check check (sex is null or sex in ('male', 'female')),
  constraint body_profile_height_check
    check (height_cm is null or height_cm between 80 and 260)
);

-- ---------------------------------------------------------------------------
-- weight_entries — at most one measurement per day.
-- ---------------------------------------------------------------------------
create table if not exists public.weight_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  measured_on  date not null default current_date,
  weight_kg    numeric(5, 2) not null,

  constraint weight_entries_weight_check check (weight_kg between 20 and 400),
  constraint weight_entries_one_per_day unique (user_id, measured_on)
);

create index if not exists weight_entries_user_date_idx
  on public.weight_entries (user_id, measured_on desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.exercises          enable row level security;
alter table public.routines           enable row level security;
alter table public.routine_days       enable row level security;
alter table public.routine_exercises  enable row level security;
alter table public.sessions           enable row level security;
alter table public.session_sets       enable row level security;
alter table public.body_profile       enable row level security;
alter table public.weight_entries     enable row level security;

-- The catalog is global: everyone reads, nobody writes from the client.
-- Without this policy the table returns zero rows and the seed looks broken.
drop policy if exists exercises_read on public.exercises;
create policy exercises_read on public.exercises
  for select to authenticated using (true);

-- The rest: everyone sees and touches only their own.
-- `using` filters what is read/modified; `with check` validates what is
-- written. The explicit `with check` documents the write rule; for an ALL
-- policy PostgreSQL would otherwise reuse `using` as its implicit check.
drop policy if exists routines_own on public.routines;
create policy routines_own on public.routines
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists routine_days_own on public.routine_days;
create policy routine_days_own on public.routine_days
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists routine_exercises_own on public.routine_exercises;
create policy routine_exercises_own on public.routine_exercises
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists sessions_own on public.sessions;
create policy sessions_own on public.sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists session_sets_own on public.session_sets;
create policy session_sets_own on public.session_sets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists body_profile_own on public.body_profile;
create policy body_profile_own on public.body_profile
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists weight_entries_own on public.weight_entries;
create policy weight_entries_own on public.weight_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
