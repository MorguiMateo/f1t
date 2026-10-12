import { renderToStaticMarkup } from "react-dom/server";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineDay, RoutineExercise } from "../features/routines/api";
import type { SessionSet } from "../features/sessions/api";
import type { ExercisePlan } from "../features/sessions/plan";
import { createWorkoutSetRegistry, type ExerciseLogWriteState } from "../features/sessions/set-editor";
import { WorkoutPage } from "./workout-page";
import { createWorkoutWriteGuard, installWorkoutUnloadProtection, workoutExitPolicy } from "./workout-write-guard";
import { createFrozenWorkoutPlans } from "../features/sessions/workout-context";

afterEach(() => vi.unstubAllGlobals());

function renderWorkout(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    return renderToStaticMarkup(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  } finally {
    client.clear();
  }
}

const mocks = vi.hoisted(() => ({
  previousError: null as Error | null,
  previousData: undefined as { sets: SessionSet[] } | null | undefined,
  sessionError: null as Error | null,
  deleteError: null as Error | null,
  exercises: [] as RoutineExercise[],
  savedSets: [] as SessionSet[],
  exerciseLog: vi.fn(),
  routineAvailable: true,
  sessionAvailable: true,
  routineError: null as Error | null,
  routineFetching: false,
  sessionFetching: false,
  routineRefetch: vi.fn(),
  sessionRefetch: vi.fn(),
  navigate: vi.fn(),
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  sessionUser: "user-1",
  sessionDay: "day-1" as string | null,
  sessionDates: [] as string[],
  loggedDay: undefined as RoutineDay | null | undefined,
  loggedDayError: null as Error | null,
  loggedDayFetching: false,
  loggedDayRefetch: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router")>(),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../features/auth/session", () => ({ useUser: () => ({ id: "user-1" }) }));

vi.mock("../features/sessions/workout-context", async (original) => ({
  ...await original<typeof import("../features/sessions/workout-context")>(),
  useOwnedLoggedDay: () => ({ data: mocks.loggedDay, error: mocks.loggedDayError, isLoading: mocks.loggedDayFetching,
    isFetching: mocks.loggedDayFetching, refetch: mocks.loggedDayRefetch }),
}));

vi.mock("../components/button", async (importOriginal) => {
  const { Button } = await importOriginal<typeof import("../components/button")>();
  return {
    Button: (props: Parameters<typeof Button>[0]) => {
      mocks.buttons.push(props);
      return <Button {...props} />;
    },
  };
});

vi.mock("../features/sessions/exercise-log", () => ({
  ExerciseLog: (props: { plan: ExercisePlan }) => {
    mocks.exerciseLog(props);
    return <li>{props.plan.exerciseId}</li>;
  },
}));

vi.mock("../features/routines/queries", () => ({
  useActiveRoutine: () => ({
    data: mocks.routineAvailable ? {
      id: "routine-1",
      days: [{ id: "day-1", user_id: "user-1", routine_id: "routine-1", weekday: 1, label: "Empuje", exercises: mocks.exercises }],
    } : undefined,
    isPending: false,
    error: mocks.routineError,
    isFetching: mocks.routineFetching,
    refetch: mocks.routineRefetch,
  }),
}));

vi.mock("../features/sessions/queries", () => ({
  useSessionForDate: (date: string) => {
    mocks.sessionDates.push(date);
    return ({
    data: mocks.sessionAvailable ? { id: "session-1", user_id: mocks.sessionUser, performed_on: date, routine_day_id: mocks.sessionDay, set_count: 1, sets: mocks.savedSets } : undefined,
    isPending: false,
    error: mocks.sessionError,
    isFetching: mocks.sessionFetching,
    refetch: mocks.sessionRefetch,
  }); },
  usePreviousSession: () => ({
    data: mocks.previousData,
    isLoading: false,
    isFetching: false,
    error: mocks.previousError,
    refetch: vi.fn(),
  }),
  useDeleteSession: () => ({
    isPending: false,
    error: mocks.deleteError,
    mutate: vi.fn(),
  }),
}));

describe("WorkoutPage write and history errors", () => {
  beforeEach(() => {
    mocks.previousError = null;
    mocks.previousData = undefined;
    mocks.sessionError = null;
    mocks.deleteError = null;
    mocks.exercises = [];
    mocks.savedSets = [];
    mocks.exerciseLog.mockClear();
    mocks.routineAvailable = true;
    mocks.sessionAvailable = true;
    mocks.routineError = null;
    mocks.routineFetching = false;
    mocks.sessionFetching = false;
    mocks.routineRefetch.mockClear();
    mocks.sessionRefetch.mockClear();
    mocks.navigate.mockClear();
    mocks.buttons = [];
    mocks.sessionUser = "user-1";
    mocks.sessionDay = "day-1";
    mocks.sessionDates = [];
    mocks.loggedDay = undefined;
    mocks.loggedDayError = null;
    mocks.loggedDayFetching = false;
    mocks.loggedDayRefetch.mockClear();
  });

  function render() {
    return renderWorkout(
      <MemoryRouter initialEntries={["/entrenar?dia=day-1"]}>
        <WorkoutPage />
      </MemoryRouter>,
    );
  }

  it("offers retry or explicit continuation when previous-session lookup fails", () => {
    mocks.previousError = new Error("offline");
    const html = render();
    expect(html).toContain("No se pudo cargar el entrenamiento anterior");
    expect(html).toContain("Reintentar");
    expect(html).toContain("Continuar sin sugerencias");
  });

  it("shows a failed workout deletion instead of silently staying on the page", () => {
    mocks.deleteError = new Error("offline");
    expect(render()).toContain("No se quitó el entrenamiento");
  });

  it("keeps the workout mounted when a background refetch fails", () => {
    mocks.previousData = { sets: [] };
    mocks.previousError = new Error("history offline");
    mocks.sessionError = new Error("session offline");
    const html = render();
    expect(html).toContain("conservamos tus datos en pantalla");
    expect(html).toContain("seguimos con la última sugerencia");
    expect(html).toContain("Terminar");
    expect(html).not.toContain("Continuar sin sugerencias");
  });

  it("keeps exercises in routine order and forwards saved sets without an exercise chooser", () => {
    mocks.exercises = ["press", "row"].map((exercise_id, position) => ({
      id: `item-${position}`,
      user_id: "user-1",
      routine_day_id: "day-1",
      exercise_id,
      position,
      target_sets: 2,
      target_reps: "8-12",
      target_weight_kg: null,
      notes: null,
    }));
    const saved: SessionSet = {
      id: "saved-1",
      session_id: "session-1",
      user_id: "user-1",
      exercise_id: "press",
      set_index: 0,
      reps: 8,
      weight_kg: 60,
    };
    mocks.savedSets = [saved];

    const html = render();
    const logs = mocks.exerciseLog.mock.calls.map(([props]) => props);
    expect(logs.map(({ plan }) => plan.exerciseId)).toEqual(["press", "row"]);
    expect(logs[0].plan.sets[0].done).toEqual(saved);
    expect(logs[0].plan.doneCount).toBe(1);
    expect(logs[1].plan.doneCount).toBe(0);
    expect(logs.every((props) => props.sessionId === "session-1" && props.routineDayId === "day-1")).toBe(true);
    expect(html).toContain("1 de 4 series");
    expect(html).not.toContain("Elegir ejercicio");
    expect(html).not.toContain("<select");
  });

  it("preserves the routine editor link when the workout day has no exercises", () => {
    const html = render();
    expect(html).toContain('href="/rutinas/routine-1/dias/day-1"');
    expect(html).toContain("Editar el día");
    expect(mocks.exerciseLog).not.toHaveBeenCalled();
  });

  it.each(["routine", "session"] as const)("retries an initial %s query failure without mounting editable rows", (query) => {
    if (query === "routine") {
      mocks.routineAvailable = false;
      mocks.routineError = new Error("offline");
    } else {
      mocks.sessionAvailable = false;
      mocks.sessionError = new Error("offline");
    }
    expect(render()).toContain("No se pudo cargar el entrenamiento");
    const retry = mocks.buttons.find((props) => props.children === "Reintentar")!;
    expect(retry.disabled).toBe(false);
    retry.onClick!(null!);
    expect(mocks.routineRefetch).toHaveBeenCalledTimes(query === "routine" ? 1 : 0);
    expect(mocks.sessionRefetch).toHaveBeenCalledTimes(query === "session" ? 1 : 0);
    expect(mocks.exerciseLog).not.toHaveBeenCalled();
  });

  it("disables the initial retry while requests are already fetching", () => {
    mocks.sessionAvailable = false;
    mocks.sessionError = new Error("offline");
    mocks.sessionFetching = true;
    render();
    const retry = mocks.buttons.find((props) => props.children === "Reintentando…")!;
    expect(retry.disabled).toBe(true);
  });

  it("guards finish synchronously against a blur write and its failure until a successful explicit retry", () => {
    mocks.exercises = [{
      id: "item-0", user_id: "user-1", routine_day_id: "day-1", exercise_id: "press",
      position: 0, target_sets: 2, target_reps: "8-12", target_weight_kg: null, notes: null,
    }];
    render();
    const finish = mocks.buttons.find((props) => props.children === "Terminar")!;
    const notify: (state: ExerciseLogWriteState) => void = mocks.exerciseLog.mock.calls[0][0].onWriteStateChange;

    notify({ pending: true, failed: false });
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();

    notify({ pending: false, failed: true });
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();

    notify({ pending: true, failed: false });
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();

    notify({ pending: false, failed: false });
    expect(mocks.navigate).not.toHaveBeenCalled();
    finish.onClick!(null!);
    expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shares the page registry across cards and keeps finish guarded through card removal, restoration and retry", async () => {
    mocks.exercises = ["press", "row"].map((exercise_id, position) => ({
      id: `item-${position}`, user_id: "user-1", routine_day_id: "day-1", exercise_id,
      position, target_sets: 2, target_reps: "8", target_weight_kg: 60, notes: null,
    }));
    render();
    const cards = mocks.exerciseLog.mock.calls.map(([props]) => props);
    const registry = cards[0].editorRegistry;
    expect(registry).toBeDefined();
    expect(cards[1].editorRegistry).toBe(registry);
    const finish = mocks.buttons.find((props) => props.children === "Terminar")!;
    const scopes = cards.map((card) => JSON.stringify([card.performedOn, card.routineDayId, card.plan.exerciseId]));
    registry.observe(scopes[0], cards[0].onWriteStateChange);
    registry.observe(scopes[1], cards[1].onWriteStateChange);
    const actions = {
      log: vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (values) => ({ id: "confirmed", values })),
      unlog: vi.fn(async () => undefined),
    };
    const series = registry.row(scopes[0], 0, null, { reps: 8, weightKg: 60 }, actions);
    series.edit("weight", "62,5");
    const saving = series.run("log", series.validate(true)!, true);
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();
    await expect(saving).rejects.toThrow("offline");
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();

    // A routine refetch can remove/re-add the card. Same page-owned registry,
    // a restored observer and row: no orphaned guard or discarded retry text.
    const restored = registry.row(scopes[0], 0, null, { reps: 8, weightKg: 80 }, actions);
    registry.observe(scopes[0], cards[0].onWriteStateChange);
    expect(restored).toBe(series);
    expect(restored.getSnapshot().weightText).toBe("62,5");
    const retry = restored.run("log", restored.validate(true)!, true);
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();
    await retry;
    finish.onClick!(null!);
    expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("does not finish a typed but never submitted draft, even before effects attach card observers", () => {
    mocks.exercises = [{
      id: "item-0", user_id: "user-1", routine_day_id: "day-1", exercise_id: "press",
      position: 0, target_sets: 2, target_reps: "8", target_weight_kg: 60, notes: null,
    }];
    render();
    const card = mocks.exerciseLog.mock.calls[0][0];
    const scope = JSON.stringify([card.performedOn, card.routineDayId, card.plan.exerciseId]);
    const actions = { log: vi.fn(), unlog: vi.fn() };
    const row = card.editorRegistry.row(scope, 0, null, { reps: 8, weightKg: 60 }, actions);
    row.edit("reps", "11");
    const finish = mocks.buttons.find(props => props.children === "Terminar")!;
    finish.onClick!(null!);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(actions.log).not.toHaveBeenCalled();
    expect(row.getSnapshot().saved).toBeNull();
  });

  it("opens a historical authenticated session from Progress using its logged day outside the active routine", () => {
    mocks.sessionDay = "old-day";
    mocks.loggedDay = { id: "old-day", user_id: "user-1", routine_id: "inactive-routine", weekday: 2,
      label: "Piernas anteriores", exercises: [{ id: "old-item", user_id: "user-1", routine_day_id: "old-day", exercise_id: "squat",
        position: 0, target_sets: 3, target_reps: "8", target_weight_kg: 70, notes: null }] };
    mocks.savedSets = [{ id: "saved-old", user_id: "user-1", session_id: "session-1", exercise_id: "squat", set_index: 0, reps: 9, weight_kg: 75 }];
    const html = renderWorkout(<MemoryRouter initialEntries={[{
      pathname: "/entrenar", search: "?fecha=2026-10-01&dia=day-1",
      state: { section: "/progreso", returnTo: "/progreso?seccion=entrenamiento" },
    }]}><WorkoutPage /></MemoryRouter>);
    expect(mocks.sessionDates).toEqual(["2026-10-01"]);
    const card = mocks.exerciseLog.mock.calls[0][0];
    expect(card.performedOn).toBe("2026-10-01");
    expect(card.sessionId).toBe("session-1");
    expect(card.routineDayId).toBe("old-day");
    expect(card.plan.exerciseId).toBe("squat");
    expect(card.plan.sets[0].done).toEqual(mocks.savedSets[0]);
    expect(html).toContain("Piernas anteriores");
    mocks.buttons.find(props => props.children === "Terminar")!.onClick!(null!);
    expect(mocks.navigate).toHaveBeenCalledWith("/progreso?seccion=entrenamiento", { replace: true });
  });

  it("rejects another account's session instead of resolving or exposing its logged sets", () => {
    mocks.sessionUser = "other-account";
    mocks.sessionDay = "their-day";
    expect(render()).toContain("No pudimos verificar el acceso");
    expect(mocks.exerciseLog).not.toHaveBeenCalled();
  });

  it("recovers the historical frozen plan and unsent correction without adopting later routine targets", () => {
    const data = new Map<string, string>();
    const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const original = { id: "old-day", routine_id: "inactive-routine", label: "Piernas originales", exercises: [
      { id: "old-item", exercise_id: "squat", target_sets: 3, target_reps: "8", target_weight_kg: 70 },
    ] };
    createFrozenWorkoutPlans("user-1", storage).freeze("2026-10-01", original, true);
    const scope = JSON.stringify(["2026-10-01", "old-day", "squat"]);
    const saved = { id: "saved-old", values: { reps: 9, weightKg: 75 } };
    createWorkoutSetRegistry("user-1", storage).row(scope, 0, saved, saved.values, { log: vi.fn(), unlog: vi.fn() }).edit("weight", "77,5");
    vi.stubGlobal("window", { localStorage: storage, history: { state: { idx: 0 } } });
    mocks.sessionDay = "old-day";
    mocks.loggedDay = { ...original, user_id: "user-1", weekday: 2,
      label: "Rutina editada", exercises: [{ ...original.exercises[0], target_weight_kg: 100,
        user_id: "user-1", routine_day_id: "old-day", position: 0, notes: null }] };
    mocks.savedSets = [{ id: "saved-old", user_id: "user-1", session_id: "session-1", exercise_id: "squat", set_index: 0, reps: 9, weight_kg: 75 }];
    const html = renderWorkout(<MemoryRouter initialEntries={["/entrenar?fecha=2026-10-01&dia=old-day"]}><WorkoutPage /></MemoryRouter>);
    const card = mocks.exerciseLog.mock.calls[0][0];
    expect(html).toContain("Piernas originales");
    expect(card.plan.targetWeightKg).toBe(70);
    expect(card.performedOn).toBe("2026-10-01");
    const recovered = card.editorRegistry.row(scope, 0, saved, { reps: 8, weightKg: 100 }, { log: vi.fn(), unlog: vi.fn() });
    recovered.adoptSuggestions({ reps: 8, weightKg: 100 }, null);
    expect(recovered.getSnapshot()).toMatchObject({ weightText: "77,5", requiresConfirmation: true, saved });
    expect(card.plan.sets[0].done.weight_kg).toBe(75);
  });

  it.each([false, true])("includes confirmed exercises alongside the frozen plan without duplicates (already frozen: %s)", (alreadyFrozen) => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); } };
    const original = { id: "old-day", routine_id: "inactive-routine", label: "Plan original", exercises: [
      { id: "old-item", exercise_id: "squat", target_sets: 3, target_reps: "8", target_weight_kg: 70 },
      ...(alreadyFrozen ? [{ id: "old-row", exercise_id: "row", target_sets: 3, target_reps: "10", target_weight_kg: 40 }] : []),
    ] };
    createFrozenWorkoutPlans("other-account", storage).freeze("2026-10-01", { ...original, label: "Otra cuenta" }, true);
    createFrozenWorkoutPlans("user-1", storage).freeze("2026-10-02", { ...original, label: "Otra fecha" }, true);
    createFrozenWorkoutPlans("user-1", storage).freeze("2026-10-01", original, true);
    const persistedBefore = [...data.entries()];
    vi.stubGlobal("window", { localStorage: storage, history: { state: { idx: 0 } } });
    mocks.sessionDay = "old-day";
    mocks.loggedDay = null;
    const savedA: SessionSet = { id: "saved-a", user_id: "user-1", session_id: "session-1", exercise_id: "squat", set_index: 0, reps: 8, weight_kg: 75 };
    const savedB: SessionSet = { ...savedA, id: "saved-b", exercise_id: "row", set_index: 2, weight_kg: 45 };
    mocks.savedSets = [savedA, savedB,
      { ...savedB, id: "foreign-account", user_id: "other-account", exercise_id: "foreign-exercise" },
      { ...savedB, id: "foreign-session", session_id: "another-session", exercise_id: "another-exercise" },
    ];
    const html = renderWorkout(<MemoryRouter initialEntries={["/entrenar?fecha=2026-10-01&dia=old-day"]}><WorkoutPage /></MemoryRouter>);
    const cards = mocks.exerciseLog.mock.calls.map(([props]) => props);
    expect(mocks.sessionDates).toEqual(["2026-10-01"]);
    expect(cards.map(card => card.plan.exerciseId)).toEqual(["squat", "row"]);
    expect(cards.every(card => card.performedOn === "2026-10-01" && card.sessionId === "session-1" && card.routineDayId === "old-day")).toBe(true);
    expect(cards[0].plan.targetWeightKg).toBe(70);
    expect(cards[0].plan.targetReps).toBe("8");
    expect(cards[1].plan.targetWeightKg).toBe(alreadyFrozen ? 40 : null);
    expect(cards[1].plan.sets[2].done).toEqual(savedB);
    expect(cards[1].plan.doneCount).toBe(1);
    expect(html).toContain("2 de 6 series");
    expect(html).toContain("Plan original");
    expect([...data.entries()]).toEqual(persistedBefore);
  });

  it("retains removed recorded exercises when their routine day no longer exists", () => {
    mocks.sessionDay = "deleted-day";
    mocks.loggedDay = null;
    mocks.savedSets = [{ id: "saved-old", user_id: "user-1", session_id: "session-1", exercise_id: "removed-press", set_index: 0, reps: 8, weight_kg: 60 }];
    expect(render()).toContain("Entrenamiento registrado");
    const card = mocks.exerciseLog.mock.calls[0][0];
    expect(card.plan.exerciseId).toBe("removed-press");
    expect(card.plan.sets[0].done.id).toBe("saved-old");
    expect(card.rememberRoutineWeight).toBe(false);
  });

  it("renders under declarative BrowserRouter without calling the data-router-only blocker", () => {
    const browser = {
      location: { pathname: "/entrenar", search: "?dia=day-1", hash: "", href: "https://f1t.invalid/entrenar?dia=day-1" },
      history: { state: { idx: 0 }, replaceState: vi.fn(), pushState: vi.fn(), go: vi.fn() },
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    };
    expect(() => renderWorkout(<BrowserRouter window={browser as unknown as Window}><WorkoutPage /></BrowserRouter>)).not.toThrow();
    expect(mocks.buttons.some(props => props.children === "Terminar")).toBe(true);
  });

  it("renders the actual workout blocker under a memory data router", () => {
    const router = createMemoryRouter([{ path: "/entrenar", element: <WorkoutPage /> }], { initialEntries: ["/entrenar?dia=day-1"] });
    const html = renderWorkout(<RouterProvider router={router} />);
    expect(html).toContain("Entrenamiento del");
    expect(html).toContain("Terminar");
    router.dispose();
  });
});

describe("unsent draft exits", () => {
  function setup() {
    const registry = createWorkoutSetRegistry();
    const date = "2026-10-10";
    const row = registry.row(JSON.stringify([date, "day", "press"]), 0, null, { reps: 8, weightKg: 60 }, {
      log: vi.fn(), unlog: vi.fn(),
    });
    const policy = () => workoutExitPolicy(registry.workoutStatus(date, "day"));
    return { registry, row, date, policy };
  }

  it("warns on reload for dirty input, stops warning after explicit discard, and removes its listener", () => {
    const { registry, row, date, policy } = setup();
    const target = new EventTarget();
    const remove = installWorkoutUnloadProtection(target as unknown as Window, () => policy().needsConfirmation);
    const clean = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    row.edit("reps", "11");
    const dirty = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    expect(policy().canFinish).toBe(false);
    expect(policy().canLeaveWithDraft).toBe(true);
    registry.discardWorkout(date, "day");
    const discarded = new Event("beforeunload", { cancelable: true }); target.dispatchEvent(discarded);
    expect(discarded.defaultPrevented).toBe(false);
    row.edit("reps", "12"); remove();
    const detached = new Event("beforeunload", { cancelable: true }); target.dispatchEvent(detached);
    expect(detached.defaultPrevented).toBe(false);
  });

  it.each(["tab", "back", "finish"])("blocks a real router %s exit and allows staying or explicitly retaining an unsent draft", async (exit) => {
    const { row, policy } = setup();
    row.edit("weight", "62,5");
    const router = createMemoryRouter([
      { path: "/", element: null }, { path: "/entrenar", element: null }, { path: "/progreso", element: null },
    ], { initialEntries: ["/", "/entrenar"], initialIndex: 1 });
    router.getBlocker("workout", () => policy().needsConfirmation);
    const leave = () => exit === "back" ? router.navigate(-1) : router.navigate(exit === "tab" ? "/progreso" : "/");
    await leave();
    expect(router.state.location.pathname).toBe("/entrenar");
    const first = router.state.blockers.get("workout")!;
    expect(first.state).toBe("blocked");
    if (first.state === "blocked") first.reset();
    expect(row.getSnapshot().weightText).toBe("62,5");
    await leave();
    const second = router.state.blockers.get("workout")!;
    expect(second.state).toBe("blocked");
    if (second.state === "blocked") second.proceed();
    await Promise.resolve();
    expect(router.state.location.pathname).toBe(exit === "tab" ? "/progreso" : "/");
    expect(row.getSnapshot().saved).toBeNull();
    expect(row.getSnapshot().weightText).toBe("62,5");
    router.dispose();
  });

  it.each(["tab", "back"])("keeps a real router %s exit blocked through an in-flight write, its failure and an explicit retry", async (exit) => {
    let resolve!: (row: { id: string; values: { reps: number; weightKg: number } }) => void;
    let reject!: (error: Error) => void;
    const response = new Promise<{ id: string; values: { reps: number; weightKg: number } }>((yes, no) => { resolve = yes; reject = no; });
    const registry = createWorkoutSetRegistry();
    const values = { reps: 8, weightKg: 60 };
    const log = vi.fn().mockImplementationOnce(() => response).mockResolvedValue({ id: "ack", values });
    const row = registry.row(JSON.stringify(["2026-10-10", "day", "press"]), 0, null, values, { log, unlog: vi.fn() });
    const policy = () => workoutExitPolicy(registry.workoutStatus("2026-10-10", "day"));
    const router = createMemoryRouter([{ path: "/", element: null }, { path: "/entrenar", element: null }, { path: "/progreso", element: null }],
      { initialEntries: ["/", "/entrenar"], initialIndex: 1 });
    router.getBlocker("workout", () => policy().needsConfirmation);
    const leave = () => exit === "back" ? router.navigate(-1) : router.navigate("/progreso");
    const saving = row.run("log", values);
    await leave();
    expect(router.state.location.pathname).toBe("/entrenar");
    expect(policy().canLeaveWithDraft).toBe(false);
    let blocker = router.state.blockers.get("workout")!;
    if (blocker.state === "blocked") blocker.reset();
    reject(new Error("offline"));
    await expect(saving).rejects.toThrow("offline");
    await leave();
    expect(router.state.location.pathname).toBe("/entrenar");
    expect(policy().canFinish).toBe(false);
    expect(row.getSnapshot().failure?.operation).toBe("log");
    blocker = router.state.blockers.get("workout")!;
    if (blocker.state === "blocked") blocker.reset();
    await row.run("log", row.validate()!);
    expect(log).toHaveBeenCalledTimes(2);
    expect(policy().canFinish).toBe(true);
    await leave();
    expect(router.state.location.pathname).toBe(exit === "back" ? "/" : "/progreso");
    router.dispose();
    // Keep the deferred's success continuation typed without Promise.withResolvers.
    void resolve;
  });

  it("keeps pending writes and deletion protected, and distinguishes failed registration from a finished workout", () => {
    expect(workoutExitPolicy({ pending: true, failed: false })).toMatchObject({ needsConfirmation: true, canDiscard: false, canLeaveWithDraft: false, canFinish: false });
    expect(workoutExitPolicy({ pending: false, failed: false }, true).canLeaveWithDraft).toBe(false);
    expect(workoutExitPolicy({ pending: false, failed: true })).toMatchObject({ needsConfirmation: true, canLeaveWithDraft: true, canFinish: false });
  });
});

describe("workout finish write guard", () => {
  it.each(["success", "failure"])("late old date/day %s is reported only to its owning scope", async (outcome) => {
    const registry = createWorkoutSetRegistry();
    const guard = createWorkoutWriteGuard();
    const oldWorkout = JSON.stringify(["2026-10-09", "day-a"]);
    const newWorkout = JSON.stringify(["2026-10-10", "day-b"]);
    const oldRowScope = JSON.stringify(["2026-10-09", "day-a", "press"]);
    const newRowScope = JSON.stringify(["2026-10-10", "day-b", "press"]);
    let resolve!: (row: { id: string; values: { reps: number; weightKg: number } }) => void;
    let reject!: (error: Error) => void;
    const response = new Promise<{ id: string; values: { reps: number; weightKg: number } }>((yes, no) => { resolve = yes; reject = no; });
    // Actual observer callbacks capture the parent render's owning scope,
    // rather than looking up the card's mutable current-scope callback.
    registry.observe(oldRowScope, (state) => guard.update(oldWorkout, "press", state));
    const values = { reps: 8, weightKg: 60 };
    const oldRow = registry.row(oldRowScope, 0, null, values, { log: () => response, unlog: async () => undefined });
    const saving = oldRow.run("log", values);
    expect(guard.status(oldWorkout)).toEqual({ pending: 1, failed: 0 });

    registry.observe(newRowScope, (state) => guard.update(newWorkout, "press", state));
    const newRow = registry.row(newRowScope, 0, null, values, { log: vi.fn(), unlog: async () => undefined });
    newRow.edit("weight", "invalid"); newRow.validate();
    const newFailure = newRow.getSnapshot().failure;
    expect(guard.status(newWorkout)).toEqual({ pending: 0, failed: 1, dirty: 1 });
    if (outcome === "success") { resolve({ id: "old-set", values }); await saving; }
    else { reject(new Error("old offline")); await expect(saving).rejects.toThrow("old offline"); }

    expect(guard.status(oldWorkout)).toEqual({ pending: 0, failed: outcome === "failure" ? 1 : 0 });
    expect(guard.status(newWorkout)).toEqual({ pending: 0, failed: 1, dirty: 1 });
    expect(newRow.getSnapshot().failure).toBe(newFailure);
    expect(newRow.getSnapshot().weightText).toBe("invalid");
  });

  it("retains the displayed failure when switching scopes and returning, and publishes successful retry", () => {
    const guard = createWorkoutWriteGuard();
    const listener = vi.fn();
    const unsubscribe = guard.subscribe(listener);
    const initial = guard.getSnapshot();
    guard.update("first-day", "press", { pending: false, failed: true });
    const failedSnapshot = guard.getSnapshot();
    expect(failedSnapshot).not.toBe(initial);
    guard.update("second-day", "row", { pending: true, failed: false });
    const returning = guard.getSnapshot().get("first-day");
    expect(returning).toEqual({ pending: 0, failed: 1 });
    expect(guard.canFinish("first-day")).toBe(false);
    expect(guard.getSnapshot()).toBe(guard.getSnapshot());

    guard.update("first-day", "press", { pending: true, failed: false });
    expect(guard.getSnapshot().get("first-day")).toEqual({ pending: 1, failed: 0 });
    guard.update("first-day", "press", { pending: false, failed: false });
    expect(guard.getSnapshot().get("first-day")).toEqual({ pending: 0, failed: 0 });
    expect(guard.canFinish("first-day")).toBe(true);
    expect(guard.getSnapshot().get("second-day")).toEqual({ pending: 1, failed: 0 });
    expect(listener).toHaveBeenCalledTimes(4);
    expect(failedSnapshot.get("first-day")).toEqual({ pending: 0, failed: 1 });

    unsubscribe();
    guard.update("second-day", "row", { pending: false, failed: false });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("waits for pending exercises and keeps another exercise's failure after a successful save", () => {
    const guard = createWorkoutWriteGuard();
    guard.update("today", "press", { pending: true, failed: false });
    guard.update("today", "row", { pending: false, failed: true });
    expect(guard.status("today")).toEqual({ pending: 1, failed: 1 });
    expect(guard.canFinish("today")).toBe(false);
    guard.update("today", "press", { pending: false, failed: false });
    expect(guard.canFinish("today")).toBe(false);
    guard.update("today", "row", { pending: true, failed: false });
    expect(guard.canFinish("today")).toBe(false);
    guard.update("today", "row", { pending: false, failed: false });
    expect(guard.canFinish("today")).toBe(true);
  });

  it("does not mix different days or clear one exercise's failure when another succeeds", () => {
    const guard = createWorkoutWriteGuard();
    guard.update("old-day", "press", { pending: true, failed: false });
    expect(guard.canFinish("new-day")).toBe(true);
    guard.update("new-day", "row", { pending: false, failed: true });
    guard.update("new-day", "press", { pending: false, failed: false });
    expect(guard.canFinish("new-day")).toBe(false);
    guard.update("old-day", "press", { pending: false, failed: false });
    expect(guard.canFinish("old-day")).toBe(true);
    expect(guard.canFinish("new-day")).toBe(false);
    guard.update("new-day", "row", { pending: false, failed: false });
    expect(guard.canFinish("new-day")).toBe(true);
  });
});
