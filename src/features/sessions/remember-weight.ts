import { rememberRoutineExerciseWeight } from "../routines/api";
import { shouldRememberWeight } from "./plan";

export type RoutineExerciseWeight = { id: string; targetWeightKg: number | null };

/**
 * Stores the weight just logged as that routine exercise's default so the next
 * workout starts with it. Scoped to one `routine_exercises` row; past sessions
 * are untouched. Errors propagate separately from the already-saved set so the
 * UI can explain that the default did not save. Existing defaults are preserved.
 */
export async function rememberLoggedWeight(input: {
  routineExercise: RoutineExerciseWeight | null;
  weightKg: number | null;
}): Promise<boolean> {
  const { routineExercise, weightKg } = input;
  if (!routineExercise) return false;
  if (!shouldRememberWeight(routineExercise.targetWeightKg, weightKg)) return false;

  return rememberRoutineExerciseWeight(routineExercise.id, weightKg);
}
