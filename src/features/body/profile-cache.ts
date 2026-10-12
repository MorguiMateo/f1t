import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  guardAuthMutation,
  isAuthQueryClientActive,
  runIfAuthQueryClientActive,
} from "../auth/auth-query-client";
import type { BodyProfile, BodyProfilePatch } from "./api";

export type ProfileField = keyof BodyProfilePatch;

export type ProfileSaveFeedback = {
  onFailed?: (fields: readonly ProfileField[], error: Error) => void;
  onConfirmed?: (fields: readonly ProfileField[], profile: BodyProfile) => void;
  onStarted?: (patch: BodyProfilePatch) => void;
};

/** A failed optimistic write may still equal the cache when its refetch fails. */
export function shouldCommitProfileField<T>(
  field: ProfileField,
  next: T,
  current: T,
  failures: Readonly<Partial<Record<ProfileField, unknown>>>,
): boolean {
  return next !== current || failures[field] !== undefined;
}

/** Keeps newer local edits visible while serialized writes return older rows. */
export class ProfileCacheOverlay {
  private nextId = 0;
  private pending = new Map<number, BodyProfilePatch>();
  private latestByField = new Map<ProfileField, number>();

  begin(patch: BodyProfilePatch): number {
    const id = ++this.nextId;
    this.pending.set(id, patch);
    for (const field of Object.keys(patch) as ProfileField[]) {
      this.latestByField.set(field, id);
    }
    return id;
  }

  settle(id: number): void {
    this.pending.delete(id);
  }

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  latestFields(id: number | undefined, patch: BodyProfilePatch): ProfileField[] {
    if (id === undefined) return [];
    return (Object.keys(patch) as ProfileField[]).filter(
      (field) => this.latestByField.get(field) === id,
    );
  }

  apply(profile: BodyProfile): BodyProfile {
    let result = profile;
    for (const patch of this.pending.values()) {
      result = { ...result, ...patch };
    }
    return result;
  }
}

export function profileSaveOptions(
  queryClient: QueryClient,
  queryKey: QueryKey,
  mutationFn: (patch: BodyProfilePatch) => Promise<BodyProfile>,
  feedback: ProfileSaveFeedback = {},
) {
  const overlay = new ProfileCacheOverlay();
  let failed = false;

  return {
    mutationFn: guardAuthMutation(queryClient, mutationFn),
    // Same-field writes must reach Postgres in gesture order, not network order.
    scope: { id: "body-profile" },
    onMutate: async (patch: BodyProfilePatch) => {
      if (!isAuthQueryClientActive(queryClient)) return undefined;
      const id = overlay.begin(patch);
      feedback.onStarted?.(patch);
      await queryClient.cancelQueries({ queryKey });
      runIfAuthQueryClientActive(queryClient, () =>
        queryClient.setQueryData<BodyProfile | null>(queryKey, (current) =>
          current ? overlay.apply(current) : current,
        ),
      );
      return id;
    },
    onSuccess: (profile: BodyProfile, patch: BodyProfilePatch, id: number | undefined) => {
      if (id !== undefined) overlay.settle(id);
      runIfAuthQueryClientActive(queryClient, () => {
        queryClient.setQueryData(queryKey, overlay.apply(profile));
        feedback.onConfirmed?.(overlay.latestFields(id, patch), profile);
        // A successful later upsert returns the final row even if an earlier one failed.
        failed = false;
      });
    },
    onError: (error: Error, patch: BodyProfilePatch, id: number | undefined) => {
      if (id !== undefined) overlay.settle(id);
      runIfAuthQueryClientActive(queryClient, () => {
        feedback.onFailed?.(overlay.latestFields(id, patch), error);
        failed = true;
        if (!overlay.hasPending) {
          void queryClient.invalidateQueries({ queryKey });
          failed = false;
        }
      });
    },
    onSettled: () => {
      runIfAuthQueryClientActive(queryClient, () => {
        if (failed && !overlay.hasPending) {
          void queryClient.invalidateQueries({ queryKey });
          failed = false;
        }
      });
    },
  };
}
