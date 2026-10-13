/** Profile edits serialize at the server and keep later drafts over older rows. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  guardAuthMutation,
  runIfAuthQueryClientActive,
} from "../auth/auth-query-client";
import { fetchBodyProfile, saveBodyProfile } from "./api";
import type { ProfileFieldState } from "./profile-draft";
import { profileSaveOptions, type ProfileField } from "./profile-cache";
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
  const [fieldStates, setFieldStates] = useState<Partial<Record<ProfileField, ProfileFieldState>>>({});
  const [failures, setFailures] = useState<Partial<Record<ProfileField, Error>>>({});
  const options = useMemo(
    () =>
      profileSaveOptions(queryClient, bodyKeys.profile(), saveBodyProfile, {
        onStarted: (patch) => {
          setFieldStates((previous) => {
            const next = { ...previous };
            for (const field of Object.keys(patch) as ProfileField[]) next[field] = { value: patch[field], status: "pending" };
            return next;
          });
        },
        onFailed: (fields, error) => {
          setFieldStates((previous) => {
            const next = { ...previous };
            for (const field of fields) if (next[field]) next[field] = { ...next[field]!, status: "failed" };
            return next;
          });
          if (!fields.length) return;
          setFailures((previous) => {
            const next = { ...previous };
            for (const field of fields) next[field] = error;
            return next;
          });
        },
        onConfirmed: (fields, profile) => {
          setFieldStates((previous) => {
            const next = { ...previous };
            for (const field of fields) next[field] = { value: profile[field], status: "saved" };
            return next;
          });
          if (!fields.length) return;
          setFailures((previous) => {
            const next = { ...previous };
            for (const field of fields) delete next[field];
            return next;
          });
        },
      }),
    [queryClient],
  );
  return { ...useMutation(options), failures, fieldStates };
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
 * series and changes its neighbour's delta.
 */
export function useSaveWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: guardAuthMutation(queryClient, saveWeight),
    onSuccess: () =>
      runIfAuthQueryClientActive(queryClient, () =>
        queryClient.invalidateQueries({ queryKey: weightKeys.entries() }),
      ),
  });
}

export function useDeleteWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: guardAuthMutation(queryClient, deleteWeightEntry),
    onSuccess: () =>
      runIfAuthQueryClientActive(queryClient, () =>
        queryClient.invalidateQueries({ queryKey: weightKeys.entries() }),
      ),
  });
}
