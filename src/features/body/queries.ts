/**
 * The profile mutation writes the returned row into the cache instead of
 * invalidating: the upsert response is the new state, and a refetch landing
 * mid-typing would flicker the form's uncontrolled inputs.
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
 * Invalidates instead of writing the returned row: one upsert reorders the
 * series and changes its neighbour's delta, and the list is only a few rows.
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
