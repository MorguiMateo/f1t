/**
 * How many set rows to show and what to put in each one.
 *
 * This is the part of logging that depends on neither React nor the network:
 * given the day's target, what has already been ticked today and what was
 * done last time, it builds the grid that gets drawn. It lives apart so it
 * can be tested without mounting a screen, which is where this arithmetic
 * breaks without anyone noticing.
 */

import type { RoutineExercise } from "../routines/api";
import type { SessionSet } from "./api";

export type PlannedSet = {
  /** `session_sets.set_index`, zero-based. */
  setIndex: number;
  /** The row already ticked today, if there is one. */
  done: SessionSet | null;
  /** The same set last time, so you know what it was done with. */
  previous: SessionSet | null;
};

export type ExercisePlan = {
  /** `routine_exercises.id`. */
  id: string;
  exerciseId: string;
  targetSets: number | null;
  targetReps: string | null;
  sets: PlannedSet[];
  doneCount: number;
};

function bySetIndex(sets: readonly SessionSet[], exerciseId: string) {
  const map = new Map<number, SessionSet>();
  for (const set of sets) {
    if (set.exercise_id === exerciseId) map.set(set.set_index, set);
  }
  return map;
}

/**
 * How many rows to draw for one exercise.
 *
 * The target rules, but never downwards: if more sets were ticked than
 * planned, all of them show. And if they are all ticked one more empty row
 * appears, because "one more" is decided in the moment and not back when the
 * routine was written; without that row you would have to go edit the day
 * just to record it.
 */
function rowCount(
  targetSets: number | null,
  done: Map<number, SessionSet>,
  previousCount: number,
): number {
  const highestDone = done.size ? Math.max(...done.keys()) + 1 : 0;
  const base = Math.max(targetSets ?? 0, highestDone, previousCount, 1);
  const allDone = done.size >= base;
  return allDone ? base + 1 : base;
}

export function planExercise(input: {
  item: Pick<RoutineExercise, "id" | "exercise_id" | "target_sets" | "target_reps">;
  /** Today's sets, for any exercise: they get filtered here. */
  logged: readonly SessionSet[];
  /** Last time's sets, same deal. */
  previous: readonly SessionSet[];
}): ExercisePlan {
  const { item } = input;
  const done = bySetIndex(input.logged, item.exercise_id);
  const past = bySetIndex(input.previous, item.exercise_id);

  const rows = rowCount(item.target_sets, done, past.size);

  const sets: PlannedSet[] = [];
  for (let setIndex = 0; setIndex < rows; setIndex++) {
    sets.push({
      setIndex,
      done: done.get(setIndex) ?? null,
      previous: past.get(setIndex) ?? null,
    });
  }

  return {
    id: item.id,
    exerciseId: item.exercise_id,
    targetSets: item.target_sets,
    targetReps: item.target_reps,
    sets,
    doneCount: done.size,
  };
}

export function planWorkout(input: {
  items: readonly Pick<
    RoutineExercise,
    "id" | "exercise_id" | "target_sets" | "target_reps"
  >[];
  logged: readonly SessionSet[];
  previous: readonly SessionSet[];
}): ExercisePlan[] {
  return input.items.map((item) =>
    planExercise({ item, logged: input.logged, previous: input.previous }),
  );
}

/**
 * The first number in a rep target. "8-12" becomes 8, "to failure" becomes
 * null.
 *
 * The first and not the last: it is the number you commit to, and correcting
 * it upwards after doing twelve is one tap; finding out twelve got recorded
 * when you did eight, on the other hand, goes unnoticed.
 */
export function parseTargetReps(targetReps: string | null): number | null {
  if (!targetReps) return null;
  const match = /\d+/.exec(targetReps);
  return match ? Number(match[0]) : null;
}

/** The values a row that hasn't been ticked yet starts out with. */
export function suggestFor(
  set: PlannedSet,
  targetReps: string | null,
): { reps: number | null; weightKg: number | null } {
  return {
    reps: set.done?.reps ?? set.previous?.reps ?? parseTargetReps(targetReps),
    weightKg: set.done?.weight_kg ?? set.previous?.weight_kg ?? null,
  };
}

export type WorkoutTotals = {
  doneSets: number;
  /** The sets the day asks for. Extra rows don't count as outstanding. */
  plannedSets: number;
  /** Σ reps × kg of what was ticked. Sets without a weight add nothing. */
  volumeKg: number;
};

export function workoutTotals(
  plans: readonly ExercisePlan[],
): WorkoutTotals {
  let doneSets = 0;
  let plannedSets = 0;
  let volumeKg = 0;

  for (const plan of plans) {
    doneSets += plan.doneCount;
    plannedSets += Math.max(plan.targetSets ?? 0, plan.doneCount);
    for (const set of plan.sets) {
      if (set.done?.reps && set.done.weight_kg) {
        volumeKg += set.done.reps * set.done.weight_kg;
      }
    }
  }

  return { doneSets, plannedSets, volumeKg };
}

/** "8 de 12 series". What goes at the very top while you train. */
export function progressLabel(totals: WorkoutTotals): string {
  if (!totals.plannedSets) return "Sin series todavía";
  return `${totals.doneSets} de ${totals.plannedSets} series`;
}
