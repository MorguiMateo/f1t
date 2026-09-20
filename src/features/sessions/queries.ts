/**
 * Los hooks de React Query sobre `sessions/api.ts`.
 *
 * Misma regla que en rutinas: cada mutación invalida **todo** el árbol
 * `["sessions"]`. Marcar una serie cambia el detalle de hoy, el `set_count`
 * que dibuja el heatmap y la racha; separarlos sería mantener una tabla de
 * dependencias para ahorrar unos KB de un solo usuario.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { heatmapStart } from "../../lib/heatmap";
import {
  deleteSession,
  ensureSession,
  fetchPreviousSession,
  fetchSessionDays,
  fetchSessionForDate,
  logSet,
  today,
  unlogSet,
  type SessionSet,
} from "./api";
import { WIDGET_WEEKS } from "./widget";

export const sessionKeys = {
  all: ["sessions"] as const,
  days: (since: string) => [...sessionKeys.all, "days", since] as const,
  onDate: (date: string) => [...sessionKeys.all, "date", date] as const,
  previous: (dayId: string, before: string) =>
    [...sessionKeys.all, "previous", dayId, before] as const,
};

/**
 * Los días entrenados que entran en el heatmap.
 *
 * El rango sale de `heatmapStart()` y no de una cuenta local: es el mismo
 * archivo que decide dónde empieza la grilla, así que la query pide exacto
 * lo que se va a dibujar. Como depende de la fecha de hoy, la clave incluye
 * el `since`: pasada la medianoche la query cambia sola.
 */
export function useSessionDays(weeks: number = WIDGET_WEEKS) {
  const since = heatmapStart({ weeks });
  return useQuery({
    queryKey: sessionKeys.days(since),
    queryFn: () => fetchSessionDays(since),
  });
}

export function useSessionForDate(date: string = today()) {
  return useQuery({
    queryKey: sessionKeys.onDate(date),
    queryFn: () => fetchSessionForDate(date),
  });
}

/** La vez pasada que se hizo este día de rutina. Sin día, no hay con qué. */
export function usePreviousSession(
  routineDayId: string | null | undefined,
  before: string = today(),
) {
  return useQuery({
    queryKey: sessionKeys.previous(routineDayId ?? "", before),
    queryFn: () =>
      fetchPreviousSession({ routineDayId: routineDayId as string, before }),
    enabled: Boolean(routineDayId),
    // El pasado no cambia mientras se entrena: no hace falta refrescarlo
    // cada vez que se marca una serie.
    staleTime: Infinity,
  });
}

function useSessionMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
): UseMutationResult<TResult, Error, TArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}

/**
 * Marcar una serie, creando la sesión del día si todavía no existe.
 *
 * Las dos cosas van juntas en una sola mutación porque desde la pantalla son
 * un solo gesto: el primer toque del día tiene que registrar la serie, no
 * pedir antes un "empezar entrenamiento" que no aporta nada. `sessionId`
 * viene cuando la pantalla ya lo conoce, y entonces se ahorra el viaje.
 */
export function useLogSet(): UseMutationResult<
  SessionSet,
  Error,
  {
    sessionId: string | null;
    performedOn: string;
    routineDayId: string | null;
    exerciseId: string;
    setIndex: number;
    reps: number | null;
    weightKg: number | null;
  }
> {
  return useSessionMutation(async (input) => {
    const sessionId =
      input.sessionId ??
      (
        await ensureSession({
          performedOn: input.performedOn,
          routineDayId: input.routineDayId,
        })
      ).id;

    return logSet({
      sessionId,
      exerciseId: input.exerciseId,
      setIndex: input.setIndex,
      reps: input.reps,
      weightKg: input.weightKg,
    });
  });
}

export const useUnlogSet = () => useSessionMutation(unlogSet);
export const useDeleteSession = () => useSessionMutation(deleteSession);
