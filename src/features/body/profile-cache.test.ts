import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  createAuthQueryClient,
  disposeAuthQueryClient,
  setAuthQueryIdentity,
} from "../auth/auth-query-client";
import type { BodyProfile, BodyProfilePatch } from "./api";
import {
  profileSaveOptions,
  shouldCommitProfileField,
  type ProfileField,
} from "./profile-cache";

const KEY = ["body", "profile"] as const;
const BASE: BodyProfile = {
  user_id: "user-1",
  updated_at: "2026-09-29",
  birth_date: null,
  goal: "maintain",
  height_cm: null,
  sex: null,
  target_weight_kg: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function failureFeedback() {
  const failures = new Map<ProfileField, Error>();
  return {
    failures,
    callbacks: {
      onFailed: (fields: readonly ProfileField[], error: Error) => {
        for (const field of fields) failures.set(field, error);
      },
      onConfirmed: (fields: readonly ProfileField[]) => {
        for (const field of fields) failures.delete(field);
      },
    },
  };
}

describe("profile save cache", () => {
  it.each([
    [{ height_cm: 180 }, { sex: "female" }, { height_cm: 180, sex: "female" }],
    [{ height_cm: 180 }, { height_cm: 181 }, { height_cm: 181 }],
  ] as [BodyProfilePatch, BodyProfilePatch, Partial<BodyProfile>][]) (
    "keeps the latest draft over an older response, then saves in order",
    async (first, second, expected) => {
      setAuthQueryIdentity("profile-order-test");
      const client = createAuthQueryClient();
      client.setQueryData(KEY, BASE);
      const firstGate = deferred<BodyProfile>();
      const secondGate = deferred<BodyProfile>();
      const mutationFn = vi
        .fn<(patch: BodyProfilePatch) => Promise<BodyProfile>>()
        .mockImplementationOnce(() => firstGate.promise)
        .mockImplementationOnce(() => secondGate.promise);
      const options = profileSaveOptions(client, KEY, mutationFn);
      const firstObserver = new MutationObserver(client, options);
      const secondObserver = new MutationObserver(client, options);

      const firstSave = firstObserver.mutate(first);
      const secondSave = secondObserver.mutate(second);
      await vi.waitFor(() => {
        expect(client.getQueryData(KEY)).toMatchObject(expected);
        expect(mutationFn).toHaveBeenCalledTimes(1);
      });

      firstGate.resolve({ ...BASE, ...first });
      await firstSave;
      expect(client.getQueryData(KEY)).toMatchObject(expected);
      await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(2));

      secondGate.resolve({ ...BASE, ...first, ...second });
      await secondSave;
      expect(client.getQueryData(KEY)).toMatchObject(expected);
      disposeAuthQueryClient(client);
      setAuthQueryIdentity(null);
    },
  );

  it("retains a later draft while creating the first profile row", async () => {
    setAuthQueryIdentity("profile-first-row-test");
    const client = createAuthQueryClient();
    client.setQueryData(KEY, null);
    const firstGate = deferred<BodyProfile>();
    const secondGate = deferred<BodyProfile>();
    const mutationFn = vi
      .fn<(patch: BodyProfilePatch) => Promise<BodyProfile>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise);
    const options = profileSaveOptions(client, KEY, mutationFn);
    const firstSave = new MutationObserver(client, options).mutate({ height_cm: 180 });
    const secondSave = new MutationObserver(client, options).mutate({ sex: "female" });

    firstGate.resolve({ ...BASE, height_cm: 180 });
    await firstSave;
    expect(client.getQueryData(KEY)).toMatchObject({ height_cm: 180, sex: "female" });
    secondGate.resolve({ ...BASE, height_cm: 180, sex: "female" });
    await secondSave;
    expect(client.getQueryData(KEY)).toMatchObject({ height_cm: 180, sex: "female" });
    disposeAuthQueryClient(client);
    setAuthQueryIdentity(null);
  });

  it("rejects a queued write after an account switch without repopulating the retired cache", async () => {
    setAuthQueryIdentity("account-a");
    const oldClient = createAuthQueryClient();
    oldClient.setQueryData(KEY, BASE);
    const firstGate = deferred<BodyProfile>();
    const writes: BodyProfilePatch[] = [];
    const mutationFn = vi.fn(async (patch: BodyProfilePatch) => {
      writes.push(patch);
      if (writes.length === 1) return firstGate.promise;
      return { ...BASE, ...patch };
    });
    const options = profileSaveOptions(oldClient, KEY, mutationFn);
    const firstSave = new MutationObserver(oldClient, options).mutate({ height_cm: 180 });
    const queuedSave = new MutationObserver(oldClient, options).mutate({ height_cm: 181 });
    const queuedRejected = expect(queuedSave).rejects.toThrow("La sesión cambió");
    await vi.waitFor(() => expect(writes).toEqual([{ height_cm: 180 }]));

    setAuthQueryIdentity("account-b");
    const newClient = createAuthQueryClient();
    // Clear data without removing the mutation queue before it can settle.
    oldClient.getQueryCache().clear();
    firstGate.resolve({ ...BASE, height_cm: 180 });
    await firstSave;
    await queuedRejected;

    expect(writes).toEqual([{ height_cm: 180 }]);
    expect(oldClient.getQueryData(KEY)).toBeUndefined();
    expect(newClient.getQueryData(KEY)).toBeUndefined();
    disposeAuthQueryClient(oldClient);
    disposeAuthQueryClient(newClient);
    setAuthQueryIdentity(null);
  });

  it("keeps field A's failure visible when a later field B succeeds", async () => {
    setAuthQueryIdentity("profile-different-field-failure");
    const client = createAuthQueryClient();
    client.setQueryData(KEY, BASE);
    const firstGate = deferred<BodyProfile>();
    const secondGate = deferred<BodyProfile>();
    const mutationFn = vi
      .fn<(patch: BodyProfilePatch) => Promise<BodyProfile>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise);
    const { failures, callbacks } = failureFeedback();
    const options = profileSaveOptions(client, KEY, mutationFn, callbacks);
    const firstSave = new MutationObserver(client, options).mutate({ height_cm: 180 });
    const firstRejected = expect(firstSave).rejects.toThrow("height rejected");
    const secondSave = new MutationObserver(client, options).mutate({ sex: "female" });
    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1));

    firstGate.reject(new Error("height rejected"));
    await firstRejected;
    expect(failures.has("height_cm")).toBe(true);
    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(2));
    secondGate.resolve({ ...BASE, sex: "female" });
    await secondSave;

    expect(client.getQueryData(KEY)).toMatchObject({ height_cm: null, sex: "female" });
    expect([...failures.keys()]).toEqual(["height_cm"]);
    disposeAuthQueryClient(client);
    setAuthQueryIdentity(null);
  });

  it("clears a field failure only after that field's retry succeeds", async () => {
    setAuthQueryIdentity("profile-same-field-retry");
    const client = createAuthQueryClient();
    client.setQueryData(KEY, BASE);
    const firstGate = deferred<BodyProfile>();
    const secondGate = deferred<BodyProfile>();
    const mutationFn = vi
      .fn<(patch: BodyProfilePatch) => Promise<BodyProfile>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise);
    const { failures, callbacks } = failureFeedback();
    const options = profileSaveOptions(client, KEY, mutationFn, callbacks);
    const firstSave = new MutationObserver(client, options).mutate({ height_cm: 180 });
    const firstRejected = expect(firstSave).rejects.toThrow("height rejected");
    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1));
    firstGate.reject(new Error("height rejected"));
    await firstRejected;
    expect(failures.has("height_cm")).toBe(true);

    const retry = new MutationObserver(client, options).mutate({ height_cm: 180 });
    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(2));
    expect(failures.has("height_cm")).toBe(true);
    secondGate.resolve({ ...BASE, height_cm: 180 });
    await retry;

    expect(failures.has("height_cm")).toBe(false);
    expect(client.getQueryData(KEY)).toMatchObject({ height_cm: 180 });
    disposeAuthQueryClient(client);
    setAuthQueryIdentity(null);
  });

  it("retries an unchanged draft when both its write and refetch failed", async () => {
    setAuthQueryIdentity("profile-failed-refetch-retry");
    const client = createAuthQueryClient();
    client.setQueryData(KEY, BASE);
    const refetch = vi.fn().mockRejectedValue(new Error("read failed"));
    const observer = new QueryObserver(client, {
      queryKey: KEY,
      queryFn: refetch,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const firstGate = deferred<BodyProfile>();
    const secondGate = deferred<BodyProfile>();
    const mutationFn = vi
      .fn<(patch: BodyProfilePatch) => Promise<BodyProfile>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise);
    const { failures, callbacks } = failureFeedback();
    const options = profileSaveOptions(client, KEY, mutationFn, callbacks);
    const firstSave = new MutationObserver(client, options).mutate({ height_cm: 180 });
    const firstRejected = expect(firstSave).rejects.toThrow("write failed");
    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1));
    firstGate.reject(new Error("write failed"));
    await firstRejected;
    await vi.waitFor(() => expect(client.getQueryState(KEY)?.status).toBe("error"));

    const current = client.getQueryData<BodyProfile>(KEY)?.height_cm ?? null;
    expect(current).toBe(180);
    expect(shouldCommitProfileField("height_cm", 180, current, Object.fromEntries(failures))).toBe(true);
    expect(shouldCommitProfileField("birth_date", null, null, Object.fromEntries(failures))).toBe(false);
    const retry = new MutationObserver(client, options).mutate({ height_cm: 180 });
    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(2));
    secondGate.resolve({ ...BASE, height_cm: 180 });
    await retry;

    expect(failures.has("height_cm")).toBe(false);
    expect(client.getQueryData(KEY)).toMatchObject({ height_cm: 180 });
    unsubscribe();
    disposeAuthQueryClient(client);
    setAuthQueryIdentity(null);
  });
});
