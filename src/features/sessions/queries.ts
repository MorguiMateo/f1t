/** Set writes change the date and day totals, but not prior workouts. */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  assertAuthQueryClientActive,
  guardAuthMutation,
  runIfAuthQueryClientActive,
} from "../auth/auth-query-client";
import { heatmapStart } from "../../lib/heatmap";
import { routineKeys } from "../routines/queries";
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
import { rememberLoggedWeight, type RoutineExerciseWeight } from "./remember-weight";
import { WIDGET_WEEKS } from "./widget";

export const sessionKeys = {
  all: ["sessions"] as const,
  allDays: () => [...sessionKeys.all, "days"] as const,
  allDates: () => [...sessionKeys.all, "date"] as const,
  days: (since: string) => [...sessionKeys.allDays(), since] as const,
  onDate: (date: string) => [...sessionKeys.allDates(), date] as const,
  previous: (dayId: string, before: string) =>
    [...sessionKeys.all, "previous", dayId, before] as const,
};

export async function invalidateSessionViews(
  queryClient: QueryClient,
  includePrevious = false,
): Promise<void> {
  if (includePrevious) {
    // Deleting an older session can change the next workout's suggestion.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
    ]);
    return;
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionKeys.allDays() }),
    queryClient.invalidateQueries({ queryKey: sessionKeys.allDates() }),
  ]);
}

/**
 * `heatmapStart()` keeps the fetched range identical to the drawn grid, and
 * `since` in the key makes the query roll over at midnight.
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

export function usePreviousSession(
  routineDayId: string | null | undefined,
  before: string = today(),
) {
  return useQuery({
    queryKey: sessionKeys.previous(routineDayId ?? "", before),
    queryFn: () =>
      fetchPreviousSession({ routineDayId: routineDayId as string, before }),
    enabled: Boolean(routineDayId),
    // The past doesn't change mid-workout; skip refetching on every tick.
    staleTime: Infinity,
  });
}

function useSessionMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  includePrevious = false,
): UseMutationResult<TResult, Error, TArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: guardAuthMutation(queryClient, mutationFn),
    onSuccess: () =>
      runIfAuthQueryClientActive(queryClient, () =>
        invalidateSessionViews(queryClient, includePrevious),
      ),
  });
}

/**
 * Creates session if needed: from the screen it's a single gesture, not a
 * separate "start workout". `sessionId` comes in to save a round trip.
 */
export type LoggedSessionSet = SessionSet & { defaultWeightError?: string };

export type LogSetInput = {
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
  exerciseId: string;
  setIndex: number;
  reps: number | null;
  weightKg: number | null;
  /** The routine row that learns its first logged weight, if unset. */
  routineExercise?: RoutineExerciseWeight | null;
};

export async function logWorkoutSet(queryClient: QueryClient, input: LogSetInput): Promise<LoggedSessionSet> {
  assertAuthQueryClientActive(queryClient);
  const sessionId =
    input.sessionId ??
    (
      await ensureSession({
        performedOn: input.performedOn,
        routineDayId: input.routineDayId,
      })
    ).id;

  // `ensureSession` may finish after an account switch; never log under the new user.
  assertAuthQueryClientActive(queryClient);
  const saved = await logSet({
    sessionId,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    reps: input.reps,
    weightKg: input.weightKg,
  });

  let remembered = false;
  let defaultWeightError: string | undefined;
  try {
    remembered = (await runIfAuthQueryClientActive(queryClient, () => rememberLoggedWeight({
      routineExercise: input.routineExercise ?? null,
      weightKg: saved.weight_kg,
    }))) ?? false;
  } catch {
    defaultWeightError = "La serie se guardó, pero no se pudo recordar el peso para futuros entrenamientos. Podés guardarlo desde la rutina.";
  }
  if (remembered) {
    await runIfAuthQueryClientActive(queryClient, () =>
      queryClient.invalidateQueries({ queryKey: routineKeys.all }),
    );
  }
  return { ...saved, ...(defaultWeightError ? { defaultWeightError } : {}) };
}

export function useLogSet(): UseMutationResult<LoggedSessionSet, Error, LogSetInput> {
  const queryClient = useQueryClient();
  return useSessionMutation((input) => logWorkoutSet(queryClient, input));
}

export const useUnlogSet = () => useSessionMutation(unlogSet);
export const useDeleteSession = () => useSessionMutation(deleteSession, true);
