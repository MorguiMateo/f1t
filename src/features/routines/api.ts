// `user_id` is never sent: it defaults to `auth.uid()` and RLS `with check`
// rejects anyone else's. Cascading deletes are also left to the schema.

import type { Tables } from "../../lib/database.types";
import { isUniqueViolation, unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type Routine = Tables<"routines">;
export type RoutineDayRow = Tables<"routine_days">;
export type RoutineExercise = Tables<"routine_exercises">;

export type RoutineDay = RoutineDayRow & { exercises: RoutineExercise[] };

export type RoutineDetail = Routine & { days: RoutineDay[] };

export type RoutineSummary = Routine & { dayCount: number };

// A whole routine is a few KB, so one nested embed beats three chained queries.
const DETAIL_SELECT =
  "*, routine_days(*, routine_exercises(*))";

type DetailRow = Routine & {
  routine_days: (RoutineDayRow & { routine_exercises: RoutineExercise[] })[];
};

// Sorted in memory rather than via PostgREST embed ordering: seven days and a
// handful of exercises cost nothing, and the ordering stays readable here.
function toDetail(row: DetailRow): RoutineDetail {
  const { routine_days, ...routine } = row;
  return {
    ...routine,
    days: routine_days
      .map(({ routine_exercises, ...day }) => ({
        ...day,
        exercises: [...routine_exercises].sort((a, b) => a.position - b.position),
      }))
      .sort((a, b) => a.weekday - b.weekday),
  };
}

export async function fetchRoutines(): Promise<RoutineSummary[]> {
  // PostgREST aggregate: returns the day count without fetching the days.
  const rows =
    unwrap(
      await supabase
        .from("routines")
        .select("*, routine_days(count)")
        .order("created_at", { ascending: true }),
    ) ?? [];

  return rows.map(({ routine_days, ...routine }) => ({
    ...routine,
    dayCount: routine_days[0]?.count ?? 0,
  }));
}

export async function fetchRoutineDetail(
  routineId: string,
): Promise<RoutineDetail | null> {
  const row = unwrap(
    await supabase
      .from("routines")
      .select(DETAIL_SELECT)
      .eq("id", routineId)
      .maybeSingle(),
  );
  return row ? toDetail(row) : null;
}

// `maybeSingle`: having no active routine is a normal state, not an error.
export async function fetchActiveRoutine(): Promise<RoutineDetail | null> {
  const row = unwrap(
    await supabase
      .from("routines")
      .select(DETAIL_SELECT)
      .eq("is_active", true)
      .maybeSingle(),
  );
  return row ? toDetail(row) : null;
}

export async function createRoutine(input: {
  name: string;
  isActive: boolean;
}): Promise<Routine> {
  return unwrapRow(
    await supabase
      .from("routines")
      .insert({ name: input.name, is_active: input.isActive })
      .select()
      .single(),
  );
}

export async function renameRoutine(input: {
  routineId: string;
  name: string;
}): Promise<void> {
  unwrap(
    await supabase
      .from("routines")
      .update({ name: input.name })
      .eq("id", input.routineId),
  );
}

export async function deleteRoutine(routineId: string): Promise<void> {
  unwrap(await supabase.from("routines").delete().eq("id", routineId));
}

// The RPC validates ownership and switches routines in one transaction. A
// failed activation must not leave the user with no active routine.
export async function activateRoutine(routineId: string): Promise<void> {
  unwrap(await supabase.rpc("activate_routine", { p_routine_id: routineId }));
}

export async function createDay(input: {
  routineId: string;
  weekday: number;
  label: string;
}): Promise<RoutineDayRow> {
  return unwrapRow(
    await supabase
      .from("routine_days")
      .insert({
        routine_id: input.routineId,
        weekday: input.weekday,
        label: input.label,
      })
      .select()
      .single(),
  );
}

export async function renameDay(input: {
  dayId: string;
  label: string;
}): Promise<void> {
  unwrap(
    await supabase
      .from("routine_days")
      .update({ label: input.label })
      .eq("id", input.dayId),
  );
}

export async function deleteDay(dayId: string): Promise<void> {
  unwrap(await supabase.from("routine_days").delete().eq("id", dayId));
}

// The next position comes from the database because the exercise is picked on
// the catalog screen, which doesn't have the day's list in hand.
export async function addExerciseToDay(input: {
  dayId: string;
  exerciseId: string;
}): Promise<RoutineExercise> {
  const last = unwrap(
    await supabase
      .from("routine_exercises")
      .select("position")
      .eq("routine_day_id", input.dayId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  const inserted = await supabase
    .from("routine_exercises")
    .insert({
      routine_day_id: input.dayId,
      exercise_id: input.exerciseId,
      position: (last?.position ?? -1) + 1,
    })
    .select()
    .single();

  if (
    isUniqueViolation(inserted.error) &&
    inserted.error?.message.includes("routine_exercises_day_exercise_key")
  ) {
    throw new Error("Este ejercicio ya está agregado a este día.");
  }

  return unwrapRow(inserted);
}

export async function updateRoutineExercise(input: {
  id: string;
  patch: {
    target_sets?: number | null;
    target_reps?: string | null;
    notes?: string | null;
  };
}): Promise<void> {
  unwrap(
    await supabase
      .from("routine_exercises")
      .update(input.patch)
      .eq("id", input.id),
  );
}

export async function removeRoutineExercise(id: string): Promise<void> {
  unwrap(await supabase.from("routine_exercises").delete().eq("id", id));
}

// The RPC locks both rows, verifies their expected positions and updates them
// atomically. Retrying stale positions surfaces an error instead of reordering
// a different pair after another device changed the day.
export async function swapExercisePositions(input: {
  a: { id: string; position: number };
  b: { id: string; position: number };
}): Promise<void> {
  const { a, b } = input;
  unwrap(
    await supabase.rpc("swap_routine_exercise_positions", {
      p_a_id: a.id,
      p_a_position: a.position,
      p_b_id: b.id,
      p_b_position: b.position,
    }),
  );
}
