/**
 * The React Query hooks on top of `sessions/api.ts`.
 *
 * Same rule as routines: every mutation invalidates the **whole**
 * `["sessions"]` tree. Ticking a set changes today's detail, the `set_count`
 * that draws the heatmap and the streak; splitting them apart would mean
 * maintaining a dependency table to save a few KB for a single user.
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
 * The days trained that fit inside the heatmap.
 *
 * The range comes from `heatmapStart()` and not from a local calculation: the
 * same file that decides where the grid begins decides what the query asks
 * for, so it fetches exactly what gets drawn. Since it depends on today's
 * date, the key includes `since`: past midnight the query rolls over on its
 * own.
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

/** Last time this routine day was trained. With no day there is nothing to ask. */
export function usePreviousSession(
  routineDayId: string | null | undefined,
  before: string = today(),
) {
  return useQuery({
    queryKey: sessionKeys.previous(routineDayId ?? "", before),
    queryFn: () =>
      fetchPreviousSession({ routineDayId: routineDayId as string, before }),
    enabled: Boolean(routineDayId),
    // The past does not change while you train: no need to refetch it every
    // time a set is ticked.
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
 * Tick a set, creating the day's session if it doesn't exist yet.
 *
 * The two go together in one mutation because from the screen they are a
 * single gesture: the first tap of the day has to record the set, not ask
 * first for a "start workout" that accomplishes nothing. `sessionId` comes in
 * when the screen already knows it, and then the round trip is saved.
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
