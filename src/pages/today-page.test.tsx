import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodayPage } from "./today-page";

const mocks = vi.hoisted(() => ({ session: null as null | { routine_day_id: string | null; sets: { exercise_id: string; set_index: number }[] }, sessionPending: false, sessionError: null as Error | null, food: null as null | { day: { target_kcal: number | null } | null; entries: { kcal: number }[] } }));
vi.mock("../features/foods/local-today", () => ({ useLocalToday: () => "2026-10-10" }));
vi.mock("../features/activity/steps-today", () => ({ StepsToday: () => <div>Pasos de hoy</div> }));
vi.mock("../features/foods/queries", () => ({ useFoodDay: () => ({ data: mocks.food, isPending: false, error: null, isFetching: false, refetch: vi.fn() }) }));
vi.mock("../features/routines/queries", () => ({ useActiveRoutine: () => ({ data: { id: "routine", days: [
  { id: "recorded", weekday: 1, label: "Piernas", exercises: [{ id: "item", exercise_id: "legs", target_sets: 2 }] },
  { id: "scheduled", weekday: 6, label: "Empuje", exercises: [{ id: "item2", exercise_id: "push", target_sets: 2 }] },
] }, isPending: false, error: null, refetch: vi.fn() }) }));
vi.mock("../features/sessions/queries", () => ({ useSessionForDate: () => ({ data: mocks.sessionPending || mocks.sessionError ? undefined : mocks.session, isPending: mocks.sessionPending, error: mocks.sessionError, refetch: vi.fn() }) }));

describe("Today adaptive workout entry", () => {
  const render = () => renderToStaticMarkup(<MemoryRouter><TodayPage /></MemoryRouter>);
  beforeEach(() => { mocks.session = null; mocks.sessionPending = false; mocks.sessionError = null; mocks.food = null; });
  it("routes continuation explicitly to the recorded day", () => {
    mocks.session = { routine_day_id: "recorded", sets: [{ exercise_id: "legs", set_index: 0 }] };
    const html = render();
    expect(html).toContain('href="/entrenar?dia=recorded"');
    expect(html).toContain("Retomar entrenamiento");
    expect(html).not.toContain('href="/entrenar?dia=scheduled"');
    expect(html.indexOf("Retomar entrenamiento")).toBeLessThan(html.indexOf("Comidas de hoy"));
    expect(html.indexOf("Comidas de hoy")).toBeLessThan(html.indexOf("Pasos de hoy"));
  });
  it("offers review only after the planned sets are explicitly registered", () => {
    mocks.session = { routine_day_id: "recorded", sets: [{ exercise_id: "legs", set_index: 0 }, { exercise_id: "legs", set_index: 1 }] };
    expect(render()).toContain("Revisar entrenamiento");
    expect(render()).not.toContain("Retomar entrenamiento");
  });
  it("does not offer a new workout while session lookup is unresolved or failed", () => {
    mocks.sessionPending = true;
    expect(render()).not.toContain('href="/entrenar');
    mocks.sessionPending = false; mocks.sessionError = new Error("offline");
    expect(render()).toContain("No se pudo consultar el entrenamiento de hoy");
    expect(render()).not.toContain('href="/entrenar');
  });
  it("does not relabel a session with a missing day as a new calendar workout", () => {
    mocks.session = { routine_day_id: "deleted", sets: [{ exercise_id: "legs", set_index: 0 }] };
    expect(render()).toContain("Revisar registros");
    expect(render()).not.toContain('href="/entrenar');
  });
  it("reads the saved calorie target and preserves a stored null target", () => {
    mocks.food = { day: { target_kcal: 1875 }, entries: [{ kcal: 123 }, { kcal: 77 }] };
    expect(render()).toContain("200 kcal registradas");
    expect(render()).toContain("1.875 kcal");
    mocks.food.day!.target_kcal = null;
    expect(render()).toContain("Este día se registró sin objetivo calculable.");
    expect(render()).not.toContain("1.875 kcal");
  });
});
