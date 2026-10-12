import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InputHTMLAttributes, ButtonHTMLAttributes } from "react";
import { ExerciseLog } from "./exercise-log";
import { createWorkoutSetRegistry } from "./set-editor";
import type { ExercisePlan } from "./plan";

const rendered = vi.hoisted(() => ({ inputs: [] as InputHTMLAttributes<HTMLInputElement>[], buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[] }));

// Keep React's actual renderer/components; capture the same event callbacks it
// gives DOM controls so the regression exercises SetRow, not a duplicate policy.
vi.mock("react/jsx-runtime", async (original) => {
  const runtime = await original<typeof import("react/jsx-runtime")>();
  function capture(type: unknown, props: unknown) {
    if (type === "input") rendered.inputs.push(props as InputHTMLAttributes<HTMLInputElement>);
    if (type === "button") rendered.buttons.push(props as ButtonHTMLAttributes<HTMLButtonElement>);
  }
  return { ...runtime,
    jsx: (...args: Parameters<typeof runtime.jsx>) => { capture(args[0], args[1]); return runtime.jsx(...args); },
    jsxs: (...args: Parameters<typeof runtime.jsxs>) => { capture(args[0], args[1]); return runtime.jsxs(...args); },
  };
});

vi.mock("react/jsx-dev-runtime", async (original) => {
  const runtime = await original<typeof import("react/jsx-dev-runtime")>();
  return { ...runtime, jsxDEV: (...args: Parameters<typeof runtime.jsxDEV>) => {
    if (args[0] === "input") rendered.inputs.push(args[1] as InputHTMLAttributes<HTMLInputElement>);
    if (args[0] === "button") rendered.buttons.push(args[1] as ButtonHTMLAttributes<HTMLButtonElement>);
    return runtime.jsxDEV(...args);
  } };
});

vi.mock("./queries", () => ({
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useUnlogSet: () => ({ mutateAsync: vi.fn() }),
}));

describe("visible registration context for workout input", () => {
  beforeEach(() => { rendered.inputs = []; rendered.buttons = []; });
  const scope = JSON.stringify(["2026-10-10", "day", "removed-exercise"]);
  const plan: ExercisePlan = {
    id: "routine-exercise", exerciseId: "removed-exercise", targetSets: 1, targetReps: "8", targetWeightKg: 60,
    doneCount: 0, sets: [{ setIndex: 0, done: null, previous: null }],
  };
  const actions = { log: vi.fn(), unlog: vi.fn() };

  it("shows dirty input as unregistered, with an explicit discard control and contextual accessible labels", () => {
    const registry = createWorkoutSetRegistry();
    const row = registry.row(scope, 0, null, { reps: 8, weightKg: 60 }, actions);
    row.edit("reps", "11");
    const html = renderToStaticMarkup(<MemoryRouter><ExerciseLog plan={plan} sessionId={null} performedOn="2026-10-10" routineDayId="day" editorRegistry={registry} /></MemoryRouter>);
    expect(html).toContain("Borrador · no registrado");
    expect(html).toContain("Descartar borrador");
    expect(html).toContain("removed-exercise: repeticiones de la serie 1");
    expect(html).toContain('aria-label="Registrar serie 1"');
    expect(html).toContain('aria-pressed="false"');
    expect(actions.log).not.toHaveBeenCalled();
  });

  it("does not call a changed registered set complete or offer to unlog it instead of saving its edit", () => {
    const registry = createWorkoutSetRegistry();
    const saved = { id: "registered", values: { reps: 8, weightKg: 60 } };
    const row = registry.row(scope, 0, saved, saved.values, actions);
    row.edit("weight", "62,5");
    const changed: ExercisePlan = { ...plan, doneCount: 1, sets: [{ setIndex: 0, previous: null, done: {
      id: "registered", user_id: "account", session_id: "session", exercise_id: plan.exerciseId, set_index: 0, reps: 8, weight_kg: 60,
    } }] };
    const html = renderToStaticMarkup(<MemoryRouter><ExerciseLog plan={changed} sessionId="session" performedOn="2026-10-10" routineDayId="day" editorRegistry={registry} /></MemoryRouter>);
    expect(html).toContain("Cambios sin registrar");
    expect(html).toContain('aria-label="Guardar cambios de la serie 1"');
    expect(html).not.toContain('aria-label="Desmarcar la serie 1"');
    expect(row.getSnapshot().saved?.values.weightKg).toBe(60);
    expect(actions.unlog).not.toHaveBeenCalled();
  });

  it("does not retry a recovered failed correction on focus/blur, even after editing, and retries once explicitly", async () => {
    const data = new Map<string, string>();
    const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const saved = { id: "registered", values: { reps: 8, weightKg: 60 } };
    const first = createWorkoutSetRegistry("account", storage);
    const old = first.row(scope, 0, saved, saved.values, { log: async () => { throw new Error("offline"); }, unlog: vi.fn() });
    old.edit("weight", "62,5");
    await expect(old.run("log", old.validate()!)).rejects.toThrow("offline");
    const log = vi.fn(async (values) => ({ id: saved.id, values }));
    const registry = createWorkoutSetRegistry("account", storage);
    const recovered = registry.row(scope, 0, saved, saved.values, { log, unlog: vi.fn() });
    const changed: ExercisePlan = { ...plan, doneCount: 1, sets: [{ setIndex: 0, previous: null, done: {
      id: "registered", user_id: "account", session_id: "session", exercise_id: plan.exerciseId, set_index: 0, reps: 8, weight_kg: 60,
    } }] };
    renderToStaticMarkup(<MemoryRouter><ExerciseLog plan={changed} sessionId="session" performedOn="2026-10-10" routineDayId="day" editorRegistry={registry} /></MemoryRouter>);
    const weight = rendered.inputs.find(input => input.inputMode === "decimal")!;
    expect(weight).toBeDefined();
    // Focus doesn't edit a field; invoking its actual blur is the critical path.
    weight.onFocus?.({} as never);
    weight.onBlur!({ relatedTarget: null } as never);
    await Promise.resolve();
    expect(log).not.toHaveBeenCalled();
    weight.onChange!({ currentTarget: { value: "65" } } as never);
    weight.onBlur!({ relatedTarget: null } as never);
    await Promise.resolve();
    expect(log).not.toHaveBeenCalled();
    const retry = rendered.buttons.find(button => button.children === "Reintentar")!;
    expect(retry).toBeDefined();
    retry.onClick!({} as never);
    // A second click while queued cannot enqueue a second write.
    retry.onClick!({} as never);
    await vi.waitFor(() => expect(recovered.getSnapshot().pending).toBe(0));
    expect(log).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 65 });
    expect(recovered.getSnapshot().requiresConfirmation).toBe(false);
    expect(recovered.getSnapshot().saved?.values.weightKg).toBe(65);
    expect(data.size).toBe(0);
  });
});
