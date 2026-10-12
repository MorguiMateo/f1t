import { describe, expect, it, vi } from "vitest";
import { createWorkoutSetRegistry, type SetValues } from "./set-editor";
import { createWorkoutDraftStore } from "./workout-drafts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
    removeItem(key: string) { data.delete(key); },
  };
}
const date = "2026-10-10";
const scope = JSON.stringify([date, "day", "press"]);
const suggested = { reps: 8, weightKg: 60 };
const actions = () => ({
  log: vi.fn(async (values: SetValues) => ({ id: "ack", values })),
  unlog: vi.fn(async () => undefined),
});

describe("account-owned persistent workout drafts", () => {
  it("recovers comma decimals and explicit blanks after reload without registering or counting a set", () => {
    const storage = memoryStorage();
    const first = createWorkoutSetRegistry("account-a", storage);
    const row = first.row(scope, 0, null, suggested, actions());
    row.edit("reps", ""); row.edit("weight", "62,5");
    const recovered = createWorkoutSetRegistry("account-a", storage);
    // Protection works before the card is mounted, too.
    expect(recovered.workoutStatus(date, "day").dirty).toBe(true);
    const writes = actions();
    const restored = recovered.row(scope, 0, null, { reps: 12, weightKg: 80 }, writes);
    restored.adoptSuggestions({ reps: 12, weightKg: 80 }, null);
    expect(restored.getSnapshot()).toMatchObject({ repsText: "", weightText: "62,5", saved: null });
    expect(writes.log).not.toHaveBeenCalled();
    expect(restored.validate()).toBeNull();
  });

  it("isolates accounts, dates, days, exercises and series, including a late old-account failure", async () => {
    const storage = memoryStorage();
    const old = createWorkoutSetRegistry("account-a", storage);
    const pending = deferred<{ id: string; values: SetValues }>();
    const row = old.row(scope, 0, null, suggested, { ...actions(), log: () => pending.promise });
    row.edit("reps", "9");
    const writing = row.run("log", row.validate()!);
    const another = createWorkoutSetRegistry("account-b", storage);
    expect(another.workoutStatus(date, "day")).toEqual({ pending: false, failed: false });
    expect(another.row(scope, 0, null, suggested, actions()).getSnapshot().repsText).toBe("8");
    pending.reject(new Error("offline"));
    await expect(writing).rejects.toThrow("offline");
    const reload = createWorkoutSetRegistry("account-a", storage);
    expect(reload.row(scope, 0, null, suggested, actions()).getSnapshot().repsText).toBe("9");
    for (const other of [JSON.stringify(["2026-10-11", "day", "press"]), JSON.stringify([date, "other-day", "press"]), JSON.stringify([date, "day", "row"])]) {
      expect(reload.row(other, 0, null, suggested, actions()).getSnapshot().dirty.reps).toBe(false);
    }
    expect(reload.row(scope, 1, null, suggested, actions()).getSnapshot().dirty.reps).toBe(false);
    expect(createWorkoutSetRegistry("account-b", storage).workoutStatus(date, "day").dirty).toBeUndefined();
  });

  it("persists an explicit first registration in flight, then retires its draft only after acknowledgment", async () => {
    const storage = memoryStorage();
    const response = deferred<{ id: string; values: SetValues }>();
    const registry = createWorkoutSetRegistry("account-a", storage);
    const row = registry.row(scope, 0, null, suggested, { ...actions(), log: () => response.promise });
    const saving = row.run("log", suggested);
    const restored = createWorkoutSetRegistry("account-a", storage).row(scope, 0, null, suggested, actions());
    expect(restored.getSnapshot().saved).toBeNull();
    expect(restored.getSnapshot().dirty.reps).toBe(true);
    expect(registry.discardWorkout(date, "day")).toBe(false);
    response.resolve({ id: "ack", values: suggested }); await saving;
    expect(storage.data.size).toBe(0);
    expect(createWorkoutSetRegistry("account-a", storage).workoutStatus(date, "day").dirty).toBeUndefined();
  });

  it("retains a newer edit when an older write succeeds, and clears the failed retry only on success", async () => {
    const storage = memoryStorage();
    const response = deferred<{ id: string; values: SetValues }>();
    const registry = createWorkoutSetRegistry("account-a", storage);
    const writes = actions(); writes.log.mockImplementationOnce(() => response.promise);
    const row = registry.row(scope, 0, null, suggested, writes);
    const saving = row.run("log", suggested);
    row.edit("weight", "67,5");
    response.resolve({ id: "ack", values: suggested }); await saving;
    const retryActions = actions(); retryActions.log.mockRejectedValueOnce(new Error("offline"));
    const reload = createWorkoutSetRegistry("account-a", storage);
    const retry = reload.row(scope, 0, { id: "ack", values: suggested }, suggested, retryActions);
    expect(retry.getSnapshot().weightText).toBe("67,5");
    await expect(retry.run("log", retry.validate()!)).rejects.toThrow("offline");
    expect(reload.workoutStatus(date, "day").failed).toBe(true);
    await retry.run("log", retry.validate()!);
    expect(reload.workoutStatus(date, "day")).toEqual({ pending: false, failed: false });
    expect(storage.data.size).toBe(0);
  });

  it("recognizes server-acknowledged recovered values without duplicating their registration", () => {
    const storage = memoryStorage();
    createWorkoutSetRegistry("account-a", storage).row(scope, 0, null, suggested, actions()).edit("reps", "9");
    const writes = actions();
    const registry = createWorkoutSetRegistry("account-a", storage);
    const row = registry.row(scope, 0, { id: "ack", values: { ...suggested, reps: 9 } }, suggested, writes);
    expect(row.getSnapshot().dirty.reps).toBe(false);
    expect(storage.data.size).toBe(0);
    expect(writes.log).not.toHaveBeenCalled();
  });

  it("discards unsent input and failed desmark requests without deleting registered sets or other workouts", async () => {
    const storage = memoryStorage();
    const registry = createWorkoutSetRegistry("account-a", storage);
    const writes = actions(); writes.unlog.mockRejectedValueOnce(new Error("offline"));
    const saved = { id: "ack", values: suggested };
    const row = registry.row(scope, 0, saved, suggested, writes);
    await expect(row.run("unlog")).rejects.toThrow("offline");
    const otherScope = JSON.stringify(["2026-10-11", "day", "press"]);
    registry.row(otherScope, 0, null, suggested, actions()).edit("reps", "12");
    const recovered = createWorkoutSetRegistry("account-a", storage);
    const freshWrites = actions();
    const restored = recovered.row(scope, 0, saved, suggested, freshWrites);
    expect(restored.getSnapshot().failure?.operation).toBe("unlog");
    expect(recovered.discardWorkout(date, "day")).toBe(true);
    expect(restored.getSnapshot().saved).toEqual(saved);
    expect(freshWrites.unlog).not.toHaveBeenCalled();
    expect(createWorkoutSetRegistry("account-a", storage).workoutStatus("2026-10-11", "day").dirty).toBe(true);
  });

  it("keeps input usable when storage fails, and retries durable discard instead of hiding the failure", () => {
    const storage = memoryStorage();
    const registry = createWorkoutSetRegistry("account-a", storage);
    const row = registry.row(scope, 0, null, suggested, actions());
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    row.edit("reps", "11");
    expect(registry.discardWorkout(date, "day")).toBe(false);
    expect(registry.getSnapshot().storageError).toBe(true);
    remove.mockRestore();
    expect(registry.discardWorkout(date, "day")).toBe(true);
    expect(storage.data.size).toBe(0);
    const denied = memoryStorage();
    vi.spyOn(denied, "setItem").mockImplementation(() => { throw new Error("full"); });
    const unavailable = createWorkoutSetRegistry("account-a", denied);
    const unsent = unavailable.row(scope, 0, null, suggested, actions());
    unsent.edit("reps", "13");
    expect(unsent.getSnapshot().repsText).toBe("13");
    expect(unavailable.getSnapshot().storageError).toBe(true);
    expect(unavailable.workoutStatus(date, "day").dirty).toBe(true);
  });

  it("ignores corrupt records and serializes only input/intent, not credentials, saved ids or network errors", async () => {
    const storage = memoryStorage();
    storage.setItem('f1t:workout-draft:v1:account-a:broken', '{');
    expect(createWorkoutDraftStore("account-a", storage).drafts.size).toBe(0);
    const writes = actions(); writes.log.mockRejectedValueOnce(new Error("secret network detail"));
    const registry = createWorkoutSetRegistry("account-a", storage);
    const row = registry.row(scope, 0, null, suggested, writes);
    await expect(row.run("log", suggested)).rejects.toThrow();
    const payload = [...storage.data.values()].find(text => text !== "{")!;
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual(["advance", "failed", "index", "operation", "repsText", "scope", "weightText"]);
    expect(payload).not.toContain("secret network detail");
  });

  it("does not report all drafts durable just because another series persisted successfully", () => {
    const storage = memoryStorage();
    const write = vi.spyOn(storage, "setItem").mockImplementationOnce(() => { throw new Error("full"); });
    const registry = createWorkoutSetRegistry("account-a", storage);
    const first = registry.row(scope, 0, null, suggested, actions());
    first.edit("reps", "11");
    registry.row(scope, 1, null, suggested, actions()).edit("reps", "12");
    expect(registry.getSnapshot().storageError).toBe(true);
    first.edit("reps", "13");
    expect(registry.getSnapshot().storageError).toBe(false);
    write.mockRestore();
  });
});
