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
