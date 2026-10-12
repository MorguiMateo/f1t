import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as catalog from "../exercises/catalog";
import { ExerciseLog } from "./exercise-log";
import type { ExercisePlan } from "./plan";
import { createWorkoutSetRegistry, type WorkoutSetRegistry } from "./set-editor";

vi.mock("./queries", () => ({
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useUnlogSet: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

describe("exercise image at workout entry", () => {
  const exercise = catalog.EXERCISES.find((item) => item.images.length > 0)!;

  function render(exerciseId: string, editorRegistry?: WorkoutSetRegistry) {
    const plan: ExercisePlan = {
      id: "routine-exercise",
      exerciseId,
      targetSets: 1,
      targetReps: "8",
      targetWeightKg: 0,
      doneCount: 0,
      sets: [{ setIndex: 0, done: null, previous: null }],
    };
    return renderToStaticMarkup(
      <MemoryRouter>
        <ExerciseLog plan={plan} sessionId={null} performedOn="2026-10-09" routineDayId={null} editorRegistry={editorRegistry} />
      </MemoryRouter>,
    );
  }

  it("loads the catalog image without opening details and keeps set controls", () => {
    const html = render(exercise.id);
    expect(html).toContain(`alt="${exercise.name}: posición inicial"`);
    expect(html).toContain(`src="${exercise.images[0]}"`);
    expect(html).toContain('loading="eager"');
    expect(html).toContain("Cargando imagen…");
    expect(html).not.toContain("<dialog");
    expect(html).toContain("Registrar serie 1");
    expect(html).toContain('value="0"');
  });

  it("keeps an exercise removed from the catalog usable with an accessible fallback", () => {
    const html = render("removed-exercise");
    expect(html).toContain("Imagen no disponible");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('loading="eager"');
    expect(html).toContain("Registrar serie 1");
  });

  it("handles an exercise with no catalog images without requesting an empty source", () => {
    vi.spyOn(catalog, "getExercise").mockReturnValue({ ...exercise, images: [] });
    const html = render(exercise.id);
    expect(html).toContain("Imagen no disponible");
    expect(html).not.toContain('src=""');
    expect(html).not.toContain("Cargando imagen…");
  });

  it("remounted cards restore failed drafts and expose their retry control alongside the image", async () => {
    const registry = createWorkoutSetRegistry();
    const scope = JSON.stringify(["2026-10-09", null, exercise.id]);
    const row = registry.row(scope, 0, null, { reps: 8, weightKg: 0 }, {
      log: async () => { throw new Error("offline: conserva este borrador"); },
      unlog: async () => undefined,
    });
    row.edit("reps", "11"); row.edit("weight", "62,5");
    await expect(row.run("log", row.validate(true)!, true)).rejects.toThrow("offline");
    const html = render(exercise.id, registry);
    expect(html).toContain('value="11"');
    expect(html).toContain('value="62,5"');
    expect(html).toContain("offline: conserva este borrador");
    expect(html).toContain("Reintentar");
    expect(html).toContain(`src="${exercise.images[0]}"`);
    expect(registry.status(scope)).toEqual({ pending: false, failed: true });
  });
});
