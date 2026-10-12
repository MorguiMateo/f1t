-- ============================================================================
-- F1t — optional starting weight per routine exercise
--
-- `target_weight_kg` pre-fills the weight inputs when a workout starts. Null
-- means "no weight chosen yet" and is different from 0 (bodyweight / empty bar).
-- The value lives on the routine_exercises row, so it is scoped to one
-- exercise in one routine day and covered by the existing owner-only RLS
-- policy; no new policy or grant is needed. Past sessions keep their own
-- session_sets.weight_kg and are never rewritten.
-- ============================================================================

alter table public.routine_exercises
  add column if not exists target_weight_kg numeric(6, 2);

alter table public.routine_exercises
  drop constraint if exists routine_exercises_target_weight_check;
alter table public.routine_exercises
  add constraint routine_exercises_target_weight_check
  check (target_weight_kg is null or target_weight_kg >= 0);
