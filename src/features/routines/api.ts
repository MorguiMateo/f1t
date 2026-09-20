/**
 * Every read and write against the `routine_*` tables.
 *
 * No React in here: these are plain async functions and the hooks live in
 * `queries.ts`. That way, the day a routine has to be resolved outside a
 * component — building the Phase 6 `WidgetPayload`, say — you just call the
 * function and you're done.
 *
 * Three things the schema handles, which is why they don't show up here:
 *
 * - **`user_id` is never sent.** All of those columns default to
 *   `auth.uid()` and the policy's `with check` rejects anything that isn't
 *   yours. Sending it from the client would be redundant, and a lie about
 *   who gets to decide identity.
 * - **Cascading deletes.** Deleting a routine takes its days with it, and
 *   deleting a day takes its exercises.
 * - **Parent/child consistency.** The composite FK `(routine_id, user_id)`
 *   makes hanging a day off somebody else's routine an integrity error.
 */

import type { Tables } from "../../lib/database.types";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type Routine = Tables<"routines">;
export type RoutineDayRow = Tables<"routine_days">;
export type RoutineExercise = Tables<"routine_exercises">;

/** A day with its exercises already sorted by `position`. */
export type RoutineDay = RoutineDayRow & { exercises: RoutineExercise[] };

/** A whole routine: what both the editor and the Today tab need. */
export type RoutineDetail = Routine & { days: RoutineDay[] };

/** The list row: the routine plus how many days it has. */
export type RoutineSummary = Routine & { dayCount: number };

// A whole routine is a few KB, so it travels in a single round trip with
// nested embeds instead of three chained queries.
const DETAIL_SELECT =
  "*, routine_days(*, routine_exercises(*))";

type DetailRow = Routine & {
  routine_days: (RoutineDayRow & { routine_exercises: RoutineExercise[] })[];
};

/**
 * Ordering is imposed here and not in the query.
 *
 * PostgREST can order embedded resources, but this is seven days and a
 * handful of exercises: sorting in memory is free and keeps the ordering
 * written somewhere you actually read, instead of scattered across query
 * modifiers.
 */
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

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchRoutines(): Promise<RoutineSummary[]> {
  // `routine_days(count)` is a PostgREST aggregate: it brings back the number
  // of days without bringing the days. The list needs nothing else from them.
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

/**
 * The active routine, with everything inside it. This is the Today tab's
 * query. `maybeSingle` rather than `single`: having no active routine is a
 * normal state, not an error.
 */
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

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

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

/**
 * Activating a routine means switching off the previous one and switching on
 * this one, **in that order**.
 *
 * `routines_one_active_idx` is a partial unique index on `user_id` where
 * `is_active`: switching this one on first would leave two active for an
 * instant and Postgres would reject the update. `eq("is_active", true)` is
 * filter enough because RLS already limits the update to your own rows.
 */
export async function activateRoutine(routineId: string): Promise<void> {
  unwrap(
    await supabase
      .from("routines")
      .update({ is_active: false })
      .eq("is_active", true),
  );
  unwrap(
    await supabase
      .from("routines")
      .update({ is_active: true })
      .eq("id", routineId),
  );
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exercises within a day
// ---------------------------------------------------------------------------

/**
 * Appends at the end. The position is read from the database and not from
 * client state: the exercise is picked from the catalog, which is a different
 * screen, and dragging the day's list all the way over there just to count
 * would be worse.
 */
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

  return unwrapRow(
    await supabase
      .from("routine_exercises")
      .insert({
        routine_day_id: input.dayId,
        exercise_id: input.exerciseId,
        position: (last?.position ?? -1) + 1,
      })
      .select()
      .single(),
  );
}

/**
 * Changes sets/reps/notes on a routine exercise. The patch uses the column
 * names on purpose: a name-translation layer for three fields only adds one
 * more place to get them wrong.
 */
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

/**
 * Reordering is swapping the positions of two neighbouring rows.
 *
 * There is no unique constraint on `(routine_day_id, position)`, so both
 * updates can go in parallel without passing through a temporary value. If
 * one failed, the worst case is two exercises sharing a position: the order
 * looks odd, nothing is lost, and tapping the arrow again fixes it.
 */
export async function swapExercisePositions(input: {
  a: { id: string; position: number };
  b: { id: string; position: number };
}): Promise<void> {
  const { a, b } = input;
  const [first, second] = await Promise.all([
    supabase
      .from("routine_exercises")
      .update({ position: b.position })
      .eq("id", a.id),
    supabase
      .from("routine_exercises")
      .update({ position: a.position })
      .eq("id", b.id),
  ]);
  unwrap(first);
  unwrap(second);
}
