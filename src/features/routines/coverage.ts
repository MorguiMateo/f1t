// Pulls `catalog.json` into the bundle: import only from `lazy()` screens.

import { getExercise } from "../exercises/catalog";
import { MUSCLES, type DatasetMuscle } from "../../lib/muscles";

// "Missing" is computed over these, not all 17 dataset muscles: neck,
// abductors, adductors and forearms are rarely trained directly and would
// flag every routine, making the warning meaningless.
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
  primary: DatasetMuscle[];
  secondary: DatasetMuscle[];
  missing: DatasetMuscle[];
  exerciseCount: number;
};

// The three sets are disjoint, the same rule `MuscleMap` uses so frequencies
// don't overflow its range.
export function muscleCoverage(exerciseIds: readonly string[]): Coverage {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  let exerciseCount = 0;

  for (const id of exerciseIds) {
    const exercise = getExercise(id);
    // Ids dropped from the curated catalog still exist in the database.
    if (!exercise) continue;
    exerciseCount++;
    for (const muscle of exercise.primaryMuscles) primary.add(muscle);
    for (const muscle of exercise.secondaryMuscles) secondary.add(muscle);
  }

  // Anatomical order, so two similar routines read the same.
  const inOrder = (set: Set<string>) => MUSCLES.filter((m) => set.has(m));

  return {
    primary: inOrder(primary),
    secondary: inOrder(secondary).filter((m) => !primary.has(m)),
    missing: KEY_MUSCLES.filter((m) => !primary.has(m) && !secondary.has(m)),
    exerciseCount,
  };
}

export function exerciseIdsOf(
  days: readonly { exercises: readonly { exercise_id: string }[] }[],
): string[] {
  return days.flatMap((day) => day.exercises.map((e) => e.exercise_id));
}
