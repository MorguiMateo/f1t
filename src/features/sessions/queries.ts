/**
 * Every mutation invalidates the whole `["sessions"]` tree: ticking a set
 * changes today's detail, set_count (heatmap), and streak.
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
): UseMutationResult<TResult, Error, TArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}

/**
 * Creates session if needed: from the screen it's a single gesture, not a
 * separate "start workout". `sessionId` comes in to save a round trip.
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
