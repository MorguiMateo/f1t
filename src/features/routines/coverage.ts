/**
 * Which muscles a routine — or a day — covers, and which it leaves out.
 *
 * It is the only piece of Phase 3 that says something the user didn't type:
 * looking at a list of exercises you can't see that back work is missing,
 * but looking at the figure you can.
 *
 * It reads the catalog from the bundle, so this module drags `catalog.json`
 * along: it can only be imported from screens already in a `lazy()` chunk.
 */

import { getExercise } from "../exercises/catalog";
import { MUSCLES, type DatasetMuscle } from "../../lib/muscles";

/**
 * The groups a balanced routine ought to hit.
 *
 * The "missing" list is computed over these only and not over the dataset's
 * 17. Neck, abductors, adductors and forearms are almost never trained
 * directly — the dataset has two neck exercises in total — so they would
 * show up as debt in absolutely every routine and the warning would stop
 * meaning anything. They do show as covered when they appear.
 */
export const KEY_MUSCLES = [
  "abdominals",
  "biceps",
  "calves",
  "chest",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const satisfies readonly DatasetMuscle[];

export type Coverage = {
  /** Worked as primary by at least one exercise. */
  primary: DatasetMuscle[];
  /** Secondary only: they get hit, but nobody trains them head on. */
  secondary: DatasetMuscle[];
  /** Major groups appearing as neither primary nor secondary. */
  missing: DatasetMuscle[];
  /** Exercises that were actually found in the catalog. */
  exerciseCount: number;
};

/**
 * The three sets are disjoint: a primary muscle is not counted again as
 * secondary. It is the same rule `MuscleMap` uses to avoid summing
 * frequencies and overflowing its range.
 */

export function muscleCoverage(exerciseIds: readonly string[]): Coverage {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  let exerciseCount = 0;

  for (const id of exerciseIds) {
    const exercise = getExercise(id);
    // An id no longer in the curated catalog doesn't break the screen: the
    // row is still in the database and here it simply contributes no muscles.
    if (!exercise) continue;
    exerciseCount++;
    for (const muscle of exercise.primaryMuscles) primary.add(muscle);
    for (const muscle of exercise.secondaryMuscles) secondary.add(muscle);
  }

  // In MUSCLES' anatomical order and not in order of appearance: that way
  // two similar routines read the same.
  const inOrder = (set: Set<string>) => MUSCLES.filter((m) => set.has(m));

  return {
    primary: inOrder(primary),
    secondary: inOrder(secondary).filter((m) => !primary.has(m)),
    missing: KEY_MUSCLES.filter((m) => !primary.has(m) && !secondary.has(m)),
    exerciseCount,
  };
}

/** Every exercise in a routine, in one flat array. */
  export function exerciseIdsOf(
    days: readonly { exercises: readonly { exercise_id: string }[] }[],
  ): string[] {
    return days.flatMap((day) => day.exercises.map((e) => e.exercise_id));
  }
