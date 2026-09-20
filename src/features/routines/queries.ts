/**
 * The React Query hooks on top of `api.ts`.
 *
 * One decision that holds for every mutation in this file: on success it
 * invalidates the **whole** `["routines"]` tree and not the specific key it
 * touched. Renaming a routine changes the list, the detail and — if it's
 * active — the Today tab; adding an exercise changes the detail and the
 * list's counter. Narrowing what to invalidate would mean inventing a
 * dependency table to save one request of a few KB over a single user's
 * data. Everything gets invalidated and there is no way for something stale
 * to stay on screen.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  activateRoutine,
  addExerciseToDay,
  createDay,
  createRoutine,
  deleteDay,
  deleteRoutine,
  fetchActiveRoutine,
  fetchRoutineDetail,
  fetchRoutines,
  removeRoutineExercise,
  renameDay,
  renameRoutine,
  swapExercisePositions,
  updateRoutineExercise,
} from "./api";

export const routineKeys = {
  all: ["routines"] as const,
  list: () => [...routineKeys.all, "list"] as const,
  detail: (routineId: string) =>
    [...routineKeys.all, "detail", routineId] as const,
  active: () => [...routineKeys.all, "active"] as const,
};

export function useRoutines() {
  return useQuery({
    queryKey: routineKeys.list(),
    queryFn: fetchRoutines,
  });
}

/**
 * A routine's detail. `routineId` can come in undefined because it comes
 * from `useParams()`, which guarantees nothing; with no id the query is
 * disabled instead of requesting `/routines?id=eq.undefined`.
 */
export function useRoutineDetail(routineId: string | undefined) {
  return useQuery({
    queryKey: routineKeys.detail(routineId ?? ""),
    queryFn: () => fetchRoutineDetail(routineId as string),
    enabled: Boolean(routineId),
  });
}

export function useActiveRoutine() {
  return useQuery({
    queryKey: routineKeys.active(),
    queryFn: fetchActiveRoutine,
  });
}

/** The wrapper that applies the invalidation described above. */
function useRoutineMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
): UseMutationResult<TResult, Error, TArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: routineKeys.all }),
  });
}

export const useCreateRoutine = () => useRoutineMutation(createRoutine);
export const useRenameRoutine = () => useRoutineMutation(renameRoutine);
export const useDeleteRoutine = () => useRoutineMutation(deleteRoutine);
export const useActivateRoutine = () => useRoutineMutation(activateRoutine);

export const useCreateDay = () => useRoutineMutation(createDay);
export const useRenameDay = () => useRoutineMutation(renameDay);
export const useDeleteDay = () => useRoutineMutation(deleteDay);

export const useAddExercise = () => useRoutineMutation(addExerciseToDay);
export const useUpdateExercise = () => useRoutineMutation(updateRoutineExercise);
export const useRemoveExercise = () => useRoutineMutation(removeRoutineExercise);
export const useSwapExercises = () => useRoutineMutation(swapExercisePositions);
