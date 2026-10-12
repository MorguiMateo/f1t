import { describe, expect, it, vi } from "vitest";
import {
  createSetEditor,
  createWorkoutSetRegistry,
  exerciseWriteState,
  parseReps,
  parseWeight,
  shouldQueueBlurSave,
  setInputError,
  suggestSetValues,
  type SetValues,
} from "./set-editor";
import { planExercise } from "./plan";
import type { SessionSet } from "./api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const values = (reps: number, weightKg: number): SetValues => ({ reps, weightKg });

describe("set input parsing", () => {
  it("accepts comma decimals and clamps to database ranges", () => {
    expect(parseWeight("81,255")).toBe(81.26);
    expect(parseWeight("10000")).toBe(9999.99);
    expect(parseReps("1000")).toBe(999);
    expect(parseReps("oops")).toBeNull();
  });
});

describe("safe one-action registration", () => {
  it("requires reps for new series while blank load remains valid for bodyweight", () => {
    expect(setInputError("", "75", true)).toContain("repeticiones");
    expect(setInputError("", "", true)).toContain("repeticiones");
    expect(setInputError("8", "", true)).toBeNull();
    expect(setInputError("", "", false)).toBeNull();
  });
  it.each(["oops", "-1", "1.5", "1000", "Infinity"])("rejects invalid reps %s without clamping", (reps) => {
    expect(setInputError(reps, "60", true)).toContain("Repeticiones");
  });
  it.each(["oops", "-1", "10000", "17,555", "1e3"])("rejects invalid load %s without changing its draft", (weight) => {
    expect(setInputError("8", weight, true)).toContain("Carga");
  });
  it("accepts comma decimals, zero and database boundaries", () => {
    expect(setInputError("999", "9999,99", true)).toBeNull();
    expect(setInputError("0", "0", true)).toBeNull();
    expect(setInputError("8", "62,5", true)).toBeNull();
  });
});

describe("performed series prefill", () => {
  const item = { id: "row", exercise_id: "press", target_sets: 3, target_reps: "8-12", target_weight_kg: 60 };
  function row(set_index: number, reps: number | null, weight_kg: number | null): SessionSet {
    return { id: `set-${set_index}`, user_id: "user", session_id: "session", exercise_id: "press", set_index, reps, weight_kg };
  }
  it("copies the closest earlier performed series without counting the untouched row", () => {
    const plan = planExercise({ item, logged: [row(0, 9, 65), row(1, 10, 67.5)], previous: [row(2, 8, 55)] });
    expect(suggestSetValues(plan.sets[2], plan)).toEqual(values(10, 67.5));
    expect(plan.sets[2].done).toBeNull();
    expect(plan.doneCount).toBe(2);
  });
  it("preserves performed zero and saved explicit blanks", () => {
    const plan = planExercise({ item, logged: [row(0, 0, 0), row(2, null, null)], previous: [row(2, 8, 55)] });
    expect(suggestSetValues(plan.sets[1], plan)).toEqual(values(0, 0));
    expect(suggestSetValues(plan.sets[2], plan)).toEqual({ reps: null, weightKg: null });
  });
  it("does not copy future series; routine and history remain fallbacks", () => {
    const plan = planExercise({ item, logged: [row(2, 20, 100)], previous: [row(0, 9, 55)] });
    expect(suggestSetValues(plan.sets[0], plan)).toEqual(values(9, 60));
    expect(suggestSetValues(plan.sets[1], plan)).toEqual(values(8, 60));
  });
});

describe("aggregate finish guard state", () => {
  it("unlocks after the last pending series succeeds", () => {
    const states = new Map([[0, { pending: true, failed: false }], [1, { pending: true, failed: false }]]);
    expect(exerciseWriteState(states.values())).toEqual({ pending: true, failed: false });
    states.set(0, { pending: false, failed: false });
    expect(exerciseWriteState(states.values()).pending).toBe(true);
    states.set(1, { pending: false, failed: false });
    expect(exerciseWriteState(states.values())).toEqual({ pending: false, failed: false });
  });
  it("keeps a failure visible through other series and unlocks only after its successful retry", () => {
    const states = new Map([[0, { pending: false, failed: true }], [1, { pending: true, failed: false }]]);
    states.set(1, { pending: false, failed: false });
    expect(exerciseWriteState(states.values())).toEqual({ pending: false, failed: true });
    states.set(0, { pending: true, failed: false });
    expect(exerciseWriteState(states.values())).toEqual({ pending: true, failed: false });
    states.set(0, { pending: false, failed: false });
    expect(exerciseWriteState(states.values())).toEqual({ pending: false, failed: false });
    expect(exerciseWriteState([])).toEqual({ pending: false, failed: false });
  });
});

describe("shared set lifecycle across overlapping writes and card remounts", () => {
  const scope = JSON.stringify(["2026-10-09", "day", "press"]);
  const suggested = values(8, 60);
  function setup(initial = null as { id: string; values: SetValues } | null) {
    const registry = createWorkoutSetRegistry();
    const log = vi.fn(async (next: SetValues) => ({ id: "set-1", values: next }));
    const actions = { log, unlog: vi.fn(async () => undefined) };
    return { registry, actions, row: registry.row(scope, 0, initial, suggested, actions) };
  }

  it("late success keeps a newer invalid draft and its validation failure", async () => {
    const { registry, row, actions } = setup();
    const saving = deferred<{ id: string; values: SetValues }>();
    actions.log.mockImplementationOnce(() => saving.promise);
    const first = row.run("log", suggested, true);
    row.edit("reps", "incomplete");
    expect(row.validate(true)).toBeNull();
    const validation = row.getSnapshot().failure;
    saving.resolve({ id: "set-1", values: suggested });
    await first;
    expect(row.getSnapshot().failure).toBe(validation);
    expect(row.getSnapshot().repsText).toBe("incomplete");
    expect(row.getSnapshot().dirty.reps).toBe(true);
    expect(registry.status(scope)).toEqual({ pending: false, failed: true });
  });

  it("late network failure cannot replace newer validation feedback", async () => {
    const { row, actions } = setup();
    const saving = deferred<{ id: string; values: SetValues }>();
    actions.log.mockImplementationOnce(() => saving.promise);
    const first = row.run("log", suggested);
    row.edit("weight", "17,555");
    row.validate();
    const validation = row.getSnapshot().failure;
    saving.reject(new Error("old network failure"));
    await expect(first).rejects.toThrow("old network failure");
    expect(row.getSnapshot().failure).toBe(validation);
    expect(row.getSnapshot().weightText).toBe("17,555");
  });

  it("restores failed drafts and retry actions from the same row on remount", async () => {
    const { registry, row, actions } = setup();
    const oldCard = vi.fn();
    registry.observe(scope, oldCard);
    actions.log.mockRejectedValueOnce(new Error("offline"));
    row.edit("weight", "62,5");
    await expect(row.run("log", row.validate(true)!, true)).rejects.toThrow("offline");

    const remounted = registry.row(scope, 0, null, values(12, 80), actions);
    expect(remounted).toBe(row);
    expect(remounted.getSnapshot().weightText).toBe("62,5");
    expect(remounted.getSnapshot().failure?.error).toBeInstanceOf(Error);
    const newCard = vi.fn();
    registry.observe(scope, newCard);
    oldCard.mockClear();
    await remounted.run("log", remounted.validate(true)!, true);
    expect(remounted.getSnapshot().failure).toBeNull();
    expect(newCard).toHaveBeenLastCalledWith({ pending: false, failed: false });
    expect(oldCard).not.toHaveBeenCalled();
  });

  it("an old card's save completion cannot clear newer pending rows on a remounted card", async () => {
    const { registry, row, actions } = setup();
    const oldSave = deferred<{ id: string; values: SetValues }>();
    const newSave = deferred<{ id: string; values: SetValues }>();
    actions.log.mockImplementationOnce(() => oldSave.promise);
    const oldCard = vi.fn();
    registry.observe(scope, oldCard);
    const first = row.run("log", suggested);
    const remounted = registry.row(scope, 0, null, suggested, actions);
    expect(remounted.getSnapshot().pending).toBe(1);
    const newer = registry.row(scope, 1, null, suggested, { log: () => newSave.promise, unlog: actions.unlog });
    const newCard = vi.fn();
    registry.observe(scope, newCard);
    const second = newer.run("log", values(9, 65));
    oldSave.resolve({ id: "set-1", values: suggested });
    await first;
    expect(newCard).toHaveBeenLastCalledWith({ pending: true, failed: false });
    expect(registry.status(scope).pending).toBe(true);
    newSave.resolve({ id: "set-2", values: values(9, 65) });
    await second;
    expect(newCard).toHaveBeenLastCalledWith({ pending: false, failed: false });
  });

  it("preserves operation ownership through overlapping correction writes", async () => {
    const { row, actions } = setup({ id: "set-1", values: suggested });
    const firstSave = deferred<{ id: string; values: SetValues }>();
    const secondSave = deferred<{ id: string; values: SetValues }>();
    actions.log.mockImplementationOnce(() => firstSave.promise).mockImplementationOnce(() => secondSave.promise);
    row.edit("weight", "65");
    const first = row.run("log", row.validate()!);
    row.edit("weight", "70");
    const second = row.run("log", row.validate()!);
    row.edit("weight", "invalid");
    row.validate();
    const latestFailure = row.getSnapshot().failure;
    firstSave.resolve({ id: "set-1", values: values(8, 65) });
    await first;
    expect(row.getSnapshot().pending).toBe(1);
    expect(row.getSnapshot().failure).toBe(latestFailure);
    secondSave.resolve({ id: "set-1", values: values(8, 70) });
    await second;
    expect(row.getSnapshot().failure).toBe(latestFailure);
    expect(row.getSnapshot().weightText).toBe("invalid");
  });

  it("does not discard locally acknowledged values on stale query reconciliation", async () => {
    const { row } = setup();
    row.edit("weight", "62,5");
    await row.run("log", row.validate()!);
    row.reconcile(null);
    row.adoptSuggestions(values(12, 80), null);
    expect(row.getSnapshot().saved?.values.weightKg).toBe(62.5);
    expect(row.getSnapshot().weightText).toBe("62.5");
  });

  it("isolates dates, days and authenticated page registries", () => {
    const { registry, row, actions } = setup();
    row.edit("reps", "invalid"); row.validate();
    for (const other of [JSON.stringify(["2026-10-10", "day", "press"]), JSON.stringify(["2026-10-09", "other-day", "press"])]) {
      expect(registry.row(other, 0, null, suggested, actions).getSnapshot().failure).toBeNull();
      expect(registry.status(other)).toEqual({ pending: false, failed: false });
    }
    const newAccountPage = createWorkoutSetRegistry();
    expect(newAccountPage.row(scope, 0, null, suggested, actions).getSnapshot().failure).toBeNull();
  });
});

describe("createSetEditor", () => {
  it("does not write an unchanged completed set", async () => {
    const log = vi.fn();
    const editor = createSetEditor(
      { id: "set-1", values: values(8, 80) },
      { log, unlog: vi.fn() },
    );

    await editor.log(values(8, 80));
    expect(log).not.toHaveBeenCalled();
  });

  it("serializes rapid blur writes so the latest values win", async () => {
    const first = deferred<{ id: string; values: SetValues }>();
    const calls: SetValues[] = [];
    const editor = createSetEditor(
      { id: "set-1", values: values(8, 80) },
      {
        log: (next) => {
          calls.push(next);
          return calls.length === 1
            ? first.promise
            : Promise.resolve({ id: "set-1", values: next });
        },
        unlog: vi.fn(),
      },
    );

    const firstWrite = editor.log(values(9, 80));
    const secondWrite = editor.log(values(9, 85));
    await Promise.resolve();
    expect(calls).toEqual([values(9, 80)]);

    first.resolve({ id: "set-1", values: values(9, 80) });
    await Promise.all([firstWrite, secondWrite]);
    expect(calls).toEqual([values(9, 80), values(9, 85)]);
    expect(editor.saved?.values).toEqual(values(9, 85));
  });

  it("unlogs only after an in-flight log and uses its returned id", async () => {
    const first = deferred<{ id: string; values: SetValues }>();
    const unlog = vi.fn(async (_id: string) => undefined);
    const editor = createSetEditor(null, { log: () => first.promise, unlog });

    const logging = editor.log(values(8, 80));
    const removing = editor.unlog();
    await Promise.resolve();
    expect(unlog).not.toHaveBeenCalled();
    first.resolve({ id: "new-set", values: values(8, 80) });
    await Promise.all([logging, removing]);
    expect(unlog).toHaveBeenCalledWith("new-set");
    expect(editor.saved).toBeNull();
  });

  it("queues a newer blur draft while the first log has no saved id yet", async () => {
    const first = deferred<{ id: string; values: SetValues }>();
    const calls: SetValues[] = [];
    const editor = createSetEditor(null, {
      log: (next) => {
        calls.push(next);
        return calls.length === 1
          ? first.promise
          : Promise.resolve({ id: "set-1", values: next });
      },
      unlog: vi.fn(),
    });

    const logging = editor.log(values(8, 80));
    expect(editor.saved).toBeNull();
    expect(editor.hasPendingLog).toBe(true);
    expect(shouldQueueBlurSave(editor, values(9, 85))).toBe(true);
    const newerDraft = editor.log(values(9, 85));
    await Promise.resolve();
    expect(calls).toEqual([values(8, 80)]);

    first.resolve({ id: "set-1", values: values(8, 80) });
    await Promise.all([logging, newerDraft]);
    expect(calls).toEqual([values(8, 80), values(9, 85)]);
    expect(editor.saved?.values).toEqual(values(9, 85));
    expect(editor.isPending).toBe(false);
  });

  it("does not queue a blur save during unlog and can reconcile after pending writes", async () => {
    const deleting = deferred<void>();
    const editor = createSetEditor(
      { id: "set-1", values: values(8, 80) },
      { log: vi.fn(), unlog: () => deleting.promise },
    );
    const removal = editor.unlog();
    expect(shouldQueueBlurSave(editor, values(9, 80))).toBe(false);
    editor.reconcile({ id: "external", values: values(10, 90) });
    expect(editor.saved?.id).toBe("set-1");

    deleting.resolve();
    await removal;
    expect(editor.isPending).toBe(false);
    editor.reconcile({ id: "external", values: values(10, 90) });
    expect(editor.saved?.id).toBe("external");
  });

  it("keeps the last saved state after failure and permits retry", async () => {
    const log = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "set-1", values: values(9, 80) });
    const editor = createSetEditor(
      { id: "set-1", values: values(8, 80) },
      { log, unlog: vi.fn() },
    );

    await expect(editor.log(values(9, 80))).rejects.toThrow("offline");
    expect(editor.saved?.values).toEqual(values(8, 80));
    await editor.log(values(9, 80));
    expect(editor.saved?.values).toEqual(values(9, 80));
  });
});
