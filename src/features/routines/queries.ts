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

// `routineId` comes from `useParams()`; without it the query stays disabled
// instead of requesting `/routines?id=eq.undefined`.
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

// Every mutation invalidates the whole `["routines"]` tree: one change touches
// the list, the detail and the Today tab, and tracking which keys depend on
// what would cost more than refetching a few KB.
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
