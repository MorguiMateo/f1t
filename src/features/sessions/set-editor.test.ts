import { describe, expect, it, vi } from "vitest";
import {
  createSetEditor,
  parseReps,
  parseWeight,
  shouldQueueBlurSave,
  type SetValues,
} from "./set-editor";

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
