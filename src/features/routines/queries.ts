/**
 * Los hooks de React Query sobre `api.ts`.
 *
 * Una decisión que vale para todas las mutaciones de este archivo: al
 * terminar se invalida **todo** el árbol `["routines"]` y no la clave puntual
 * que se tocó. Renombrar una rutina cambia la lista, el detalle y —si está
 * activa— la pestaña Hoy; agregar un ejercicio cambia el detalle y el
 * contador de la lista. Afinar qué invalidar sería inventar una tabla de
 * dependencias para ahorrar un request de pocos KB sobre datos de un solo
 * usuario. Se invalida todo y no hay forma de que quede algo viejo en
 * pantalla.
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
 * El detalle de una rutina. `routineId` puede venir undefined porque sale de
 * `useParams()`, que no garantiza nada; sin id la query queda deshabilitada
 * en lugar de pedir `/routines?id=eq.undefined`.
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

/** El envoltorio que aplica la invalidación descrita arriba. */
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
