-- ============================================================================
-- F1t — schema inicial (PLAN.md §3)
--
-- Dos reglas que atraviesan todo el archivo:
--
--   1. RLS en TODA tabla con datos de usuario. La anon key es pública por
--      diseño: lo único que separa tus datos de los de otro es la policy.
--   2. Cada tabla de usuario lleva su propio `user_id`, incluso las hijas.
--      Así la policy es `user_id = auth.uid()` directo, sin subconsultas por
--      fila. La consistencia entre padre e hija la garantiza una FK compuesta,
--      no la confianza en el cliente.
--
-- Se usa `(select auth.uid())` y no `auth.uid()` a secas: entre paréntesis
-- Postgres lo evalúa una vez por consulta (initplan) en lugar de una vez por
-- fila. Sobre miles de filas la diferencia es grande.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- exercises — catálogo global, sin user_id, solo lectura.
-- Se llena con el seed que genera scripts/fetch-exercises.mjs (Fase 2).
-- El id es el slug de free-exercise-db ("Barbell_Full_Squat").
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

  -- Vocabularios cerrados, verificados contra el dataset (PLAN.md §2).
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

  -- La necesita la FK compuesta de routine_days.
  constraint routines_id_user_key unique (id, user_id)
);

create index if not exists routines_user_idx on public.routines (user_id);

-- Una sola rutina activa por usuario. Parcial: los false no compiten.
create unique index if not exists routines_one_active_idx
  on public.routines (user_id) where is_active;

-- ---------------------------------------------------------------------------
-- routine_days — un día sin fila = descanso. weekday 0 = domingo.
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
-- sessions — un entrenamiento por día.
--
-- ⚠ INVARIANTE (PLAN.md §5.2): `performed_on` y `set_count` son exactamente
--   lo que consume HeatmapSession en src/lib/heatmap.ts. No renombrar sin
--   cambiar el heatmap y, más adelante, el widget de SwiftUI.
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  performed_on     date not null default current_date,
  -- Se borra la rutina pero el historial queda: set null, no cascade.
  routine_day_id   uuid references public.routine_days on delete set null,
  set_count        integer not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),

  constraint sessions_set_count_check check (set_count >= 0),
  -- Lo que el heatmap asume: una fila por día.
  constraint sessions_one_per_day unique (user_id, performed_on),
  constraint sessions_id_user_key unique (id, user_id)
);

-- El heatmap pide un rango de fechas de un usuario: este índice es ese query.
create index if not exists sessions_user_date_idx
  on public.sessions (user_id, performed_on desc);

-- ---------------------------------------------------------------------------
-- session_sets — el detalle serie por serie.
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

-- Para el futuro gráfico de progresión por ejercicio.
create index if not exists session_sets_exercise_idx
  on public.session_sets (user_id, exercise_id);

-- ---------------------------------------------------------------------------
-- body_profile — una fila por usuario.
-- `sex` es el que pide Mifflin-St Jeor para estimar TDEE (Fase 5).
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
-- weight_entries — una medición por día como máximo.
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

-- El catálogo es global: todos leen, nadie escribe desde el cliente.
-- Sin esta policy la tabla devuelve cero filas y parece que falló el seed.
drop policy if exists exercises_read on public.exercises;
create policy exercises_read on public.exercises
  for select to authenticated using (true);

-- El resto: cada uno ve y toca solo lo suyo.
-- `using` filtra lo que se lee/modifica; `with check` valida lo que se escribe.
-- Hacen falta las dos: sin `with check` se podrían insertar filas ajenas.
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
