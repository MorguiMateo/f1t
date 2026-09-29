import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkoutPage } from "./workout-page";

const mocks = vi.hoisted(() => ({
  previousError: null as Error | null,
  previousData: undefined as { sets: [] } | null | undefined,
  sessionError: null as Error | null,
  deleteError: null as Error | null,
}));

vi.mock("../features/routines/queries", () => ({
  useActiveRoutine: () => ({
    data: {
      id: "routine-1",
      days: [{ id: "day-1", routine_id: "routine-1", weekday: 1, label: "Empuje", exercises: [] }],
    },
    isPending: false,
    error: null,
  }),
}));

vi.mock("../features/sessions/queries", () => ({
  useSessionForDate: () => ({
    data: { id: "session-1", set_count: 1, sets: [] },
    isPending: false,
    error: mocks.sessionError,
  }),
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
  });

  function render() {
    return renderToStaticMarkup(
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
    expect(render()).toContain("No se borró el entrenamiento");
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
});
