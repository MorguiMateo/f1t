import type { RoutineExercise } from "../routines/api";
import type { SessionSet } from "./api";

export type PlannedSet = {
  setIndex: number;
  done: SessionSet | null;
  previous: SessionSet | null;
};

export type ExercisePlan = {
  id: string;
  exerciseId: string;
  targetSets: number | null;
  targetReps: string | null;
  /** Routine default; null means none chosen, 0 is a real weight. */
  targetWeightKg: number | null;
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
 * Never fewer rows than sets already ticked. Once all are ticked an extra empty
 * row appears, so an unplanned extra set doesn't require editing the routine.
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

type PlanItem = Pick<
  RoutineExercise,
  "id" | "exercise_id" | "target_sets" | "target_reps"
> & { target_weight_kg?: number | null };

export function planExercise(input: {
  item: PlanItem;
  /** Sets for every exercise; filtered here. */
  logged: readonly SessionSet[];
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
    targetWeightKg: item.target_weight_kg ?? null,
    sets,
    doneCount: done.size,
  };
}

export function planWorkout(input: {
  items: readonly PlanItem[];
  logged: readonly SessionSet[];
  previous: readonly SessionSet[];
}): ExercisePlan[] {
  return input.items.map((item) =>
    planExercise({ item, logged: input.logged, previous: input.previous }),
  );
}

/**
 * "8-12" becomes 8: under-suggesting is fixed with one tap, while an
 * over-suggested 12 recorded when you did 8 goes unnoticed.
 */
export function parseTargetReps(targetReps: string | null): number | null {
  if (!targetReps) return null;
  const match = /\d+/.exec(targetReps);
  return match ? Number(match[0]) : null;
}

/**
 * Suggestions only fill inputs; they never create a logged set, so they can't
 * count as done. Weight order: what was ticked today, the routine's explicit
 * weight, then last session's weight for this set. `??` keeps a real 0.
 */
export function suggestFor(
  set: PlannedSet,
  targetReps: string | null,
  targetWeightKg: number | null = null,
): { reps: number | null; weightKg: number | null } {
  return {
    reps: set.done ? set.done.reps : set.previous?.reps ?? parseTargetReps(targetReps),
    weightKg:
      set.done ? set.done.weight_kg : targetWeightKg ?? set.previous?.weight_kg ?? null,
  };
}

/** Learn only the first weight; explicit routine defaults (including 0) stay put. */
export function shouldRememberWeight(
  current: number | null | undefined,
  logged: number | null,
): logged is number {
  return current == null && logged !== null;
}

export type WorkoutTotals = {
  doneSets: number;
  plannedSets: number;
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

export function progressLabel(totals: WorkoutTotals): string {
  if (!totals.plannedSets) return "Sin series todavía";
  return `${totals.doneSets} de ${totals.plannedSets} series`;
}
