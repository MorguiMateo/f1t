/**
 * The React Query hooks on top of `body/api.ts`.
 *
 * There is a single key because there is a single row. The mutation writes
 * the row the server returns straight into the cache instead of invalidating
 * and asking again: the response to an upsert *is* the new state of the
 * profile, so a refetch would be a round trip whose only possible answer is
 * what we already have in hand.
 *
 * That also matters for the form. The inputs are uncontrolled, and an
 * invalidation that lands while another field has focus is exactly the kind
 * of re-render that makes a half-typed value flicker.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchBodyProfile, saveBodyProfile, type BodyProfile } from "./api";
import {
  deleteWeightEntry,
  fetchWeightEntries,
  saveWeight,
} from "./weight-api";

export const bodyKeys = {
  all: ["body"] as const,
  profile: () => [...bodyKeys.all, "profile"] as const,
};

export function useBodyProfile() {
  return useQuery({
    queryKey: bodyKeys.profile(),
    queryFn: fetchBodyProfile,
  });
}

export function useSaveBodyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveBodyProfile,
    onSuccess: (profile: BodyProfile) => {
      queryClient.setQueryData(bodyKeys.profile(), profile);
    },
  });
}

export const weightKeys = {
  all: ["weight"] as const,
  entries: () => [...weightKeys.all, "entries"] as const,
};

export function useWeightEntries() {
  return useQuery({
    queryKey: weightKeys.entries(),
    queryFn: fetchWeightEntries,
  });
}

/**
 * Recording or deleting a weight invalidates the list instead of writing the
 * one returned row into the cache — the opposite of the profile mutation just
 * above. A single upsert reorders the series and changes the delta of the
 * neighbour it lands next to, so the honest answer is the refetched list, and
 * it is only a handful of rows.
 */
export function useSaveWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveWeight,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: weightKeys.entries() });
    },
  });
}

export function useDeleteWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWeightEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: weightKeys.entries() });
    },
  });
}
