import { describe, expect, it } from "vitest";
import type { SessionSet } from "./api";
import {
  parseTargetReps,
  planExercise,
  planWorkout,
  progressLabel,
  suggestFor,
  workoutTotals,
} from "./plan";

const BENCH = "Barbell_Bench_Press_-_Medium_Grip";
const SQUAT = "Barbell_Full_Squat";

function item(overrides: Partial<{
  id: string;
  exercise_id: string;
  target_sets: number | null;
  target_reps: string | null;
}> = {}) {
  return {
    id: "re-1",
    exercise_id: BENCH,
    target_sets: 3,
    target_reps: "8-12",
    ...overrides,
  };
}

function set(
  exerciseId: string,
  setIndex: number,
  reps: number | null = 10,
  weightKg: number | null = 60,
): SessionSet {
  return {
    id: `${exerciseId}-${setIndex}`,
    user_id: "u",
    session_id: "s",
    exercise_id: exerciseId,
    set_index: setIndex,
    reps,
    weight_kg: weightKg,
  };
}

describe("planExercise", () => {
  it("sin nada marcado hay una fila por serie objetivo", () => {
    const plan = planExercise({ item: item(), logged: [], previous: [] });
    expect(plan.sets).toHaveLength(3);
    expect(plan.doneCount).toBe(0);
    expect(plan.sets.every((s) => s.done === null)).toBe(true);
  });

  it("sin objetivo igual hay una fila para empezar", () => {
    const plan = planExercise({
      item: item({ target_sets: null }),
      logged: [],
      previous: [],
    });
    expect(plan.sets).toHaveLength(1);
  });

  it("solo mira las series de su propio ejercicio", () => {
    const plan = planExercise({
      item: item(),
      logged: [set(BENCH, 0), set(SQUAT, 0), set(SQUAT, 1)],
      previous: [],
    });
    expect(plan.doneCount).toBe(1);
    expect(plan.sets[0].done).not.toBeNull();
    expect(plan.sets[1].done).toBeNull();
  });

  it("con todo el objetivo marcado ofrece una serie más", () => {
    const plan = planExercise({
      item: item(),
      logged: [set(BENCH, 0), set(BENCH, 1), set(BENCH, 2)],
      previous: [],
    });
    expect(plan.sets).toHaveLength(4);
    expect(plan.sets[3].done).toBeNull();
  });

  it("nunca esconde una serie ya marcada por encima del objetivo", () => {
    const plan = planExercise({
      item: item({ target_sets: 2 }),
      logged: [set(BENCH, 4)],
      previous: [],
    });
    // Five rows: the fifth is the ticked one, and the four before it stay
    // visible and empty instead of disappearing.
    expect(plan.sets).toHaveLength(5);
    expect(plan.sets[4].done).not.toBeNull();
    expect(plan.doneCount).toBe(1);
  });

  it("la vez pasada también estira la grilla", () => {
    const plan = planExercise({
      item: item({ target_sets: 2 }),
      logged: [],
      previous: [set(BENCH, 0), set(BENCH, 1), set(BENCH, 2), set(BENCH, 3)],
    });
    expect(plan.sets).toHaveLength(4);
    expect(plan.sets[3].previous).not.toBeNull();
  });
});

describe("suggestFor", () => {
  it("lo marcado hoy gana sobre todo lo demás", () => {
    const plan = planExercise({
      item: item(),
      logged: [set(BENCH, 0, 11, 70)],
      previous: [set(BENCH, 0, 8, 60)],
    });
    expect(suggestFor(plan.sets[0], plan.targetReps)).toEqual({
      reps: 11,
      weightKg: 70,
    });
  });

  it("sin nada marcado hoy sugiere lo de la vez pasada", () => {
    const plan = planExercise({
      item: item(),
      logged: [],
      previous: [set(BENCH, 0, 9, 65)],
    });
    expect(suggestFor(plan.sets[0], plan.targetReps)).toEqual({
      reps: 9,
      weightKg: 65,
    });
  });

  it("sin historial, las reps salen del objetivo y el peso queda vacío", () => {
    const plan = planExercise({ item: item(), logged: [], previous: [] });
    expect(suggestFor(plan.sets[0], plan.targetReps)).toEqual({
      reps: 8,
      weightKg: null,
    });
  });
});

describe("parseTargetReps", () => {
  it("toma el primero del rango", () => {
    expect(parseTargetReps("8-12")).toBe(8);
  });

  it("entiende un número solo", () => {
    expect(parseTargetReps("5")).toBe(5);
  });

  it("un objetivo sin número no sugiere nada", () => {
    expect(parseTargetReps("al fallo")).toBeNull();
    expect(parseTargetReps(null)).toBeNull();
  });

  it("saca el número aunque venga con texto", () => {
    expect(parseTargetReps("30 s")).toBe(30);
  });
});

describe("workoutTotals", () => {
  const plans = planWorkout({
    items: [
      item(),
      item({ id: "re-2", exercise_id: SQUAT, target_sets: 4, target_reps: "5" }),
    ],
    logged: [set(BENCH, 0, 10, 60), set(BENCH, 1, 8, 60), set(SQUAT, 0, 5, 100)],
    previous: [],
  });

  it("cuenta lo hecho y lo planeado", () => {
    const totals = workoutTotals(plans);
    expect(totals.doneSets).toBe(3);
    expect(totals.plannedSets).toBe(7);
  });

  it("el volumen es reps por kilos", () => {
    // 10×60 + 8×60 + 5×100 = 600 + 480 + 500
    expect(workoutTotals(plans).volumeKg).toBe(1580);
  });

  it("una serie sin peso no suma volumen pero sí cuenta como hecha", () => {
    const bodyweight = planWorkout({
      items: [item({ exercise_id: "Pullups", target_sets: 2 })],
      logged: [set("Pullups", 0, 12, null)],
      previous: [],
    });
    const totals = workoutTotals(bodyweight);
    expect(totals.doneSets).toBe(1);
    expect(totals.volumeKg).toBe(0);
  });

  it("pasarse del objetivo no deja pendientes negativas", () => {
    const extra = planWorkout({
      items: [item({ target_sets: 2 })],
      logged: [set(BENCH, 0), set(BENCH, 1), set(BENCH, 2)],
      previous: [],
    });
    const totals = workoutTotals(extra);
    expect(totals.doneSets).toBe(3);
    expect(totals.plannedSets).toBe(3);
  });
});

describe("progressLabel", () => {
  it("dice cuántas de cuántas", () => {
    expect(progressLabel({ doneSets: 3, plannedSets: 9, volumeKg: 0 })).toBe(
      "3 de 9 series",
    );
  });

  it("un día sin objetivo ni series marcadas no inventa un cero de cero", () => {
    expect(progressLabel({ doneSets: 0, plannedSets: 0, volumeKg: 0 })).toBe(
      "Sin series todavía",
    );
  });
});
