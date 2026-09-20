/**
 * Cuántas filas de serie mostrar y qué escribir en cada una.
 *
 * Es la parte del registro que no depende ni de React ni de la red: dado el
 * objetivo del día, lo que ya se marcó hoy y lo que se hizo la vez pasada,
 * arma la grilla que se dibuja. Vive aparte para poder testearla sin montar
 * una pantalla, que es donde estas cuentas se rompen sin que nadie se entere.
 */

import type { RoutineExercise } from "../routines/api";
import type { SessionSet } from "./api";

export type PlannedSet = {
  /** `session_sets.set_index`, base 0. */
  setIndex: number;
  /** La fila ya marcada hoy, si existe. */
  done: SessionSet | null;
  /** La misma serie la vez pasada, para saber con cuánto se hizo. */
  previous: SessionSet | null;
};

export type ExercisePlan = {
  /** `routine_exercises.id`. */
  id: string;
  exerciseId: string;
  targetSets: number | null;
  targetReps: string | null;
  sets: PlannedSet[];
  doneCount: number;
};

function bySetIndex(sets: readonly SessionSet[], exerciseId: string) {
  const map = new Map<number, SessionSet>();
  for (const set of sets) {
    if (set.exercise_id === exerciseId) map.set(set.set_index, set);
  }
  return map;
}

/**
 * Cuántas filas dibujar para un ejercicio.
 *
 * El objetivo manda, pero nunca hacia abajo: si se marcaron más series de
 * las planeadas, se muestran todas. Y si están todas marcadas se agrega una
 * fila vacía más, porque "una más" es una decisión que se toma en el
 * momento y no cuando se armó la rutina; sin esa fila habría que ir a editar
 * el día para poder registrarla.
 */
function rowCount(
  targetSets: number | null,
  done: Map<number, SessionSet>,
  previousCount: number,
): number {
  const highestDone = done.size ? Math.max(...done.keys()) + 1 : 0;
  const base = Math.max(targetSets ?? 0, highestDone, previousCount, 1);
  const allDone = done.size >= base;
  return allDone ? base + 1 : base;
}

export function planExercise(input: {
  item: Pick<RoutineExercise, "id" | "exercise_id" | "target_sets" | "target_reps">;
  /** Las series de hoy, de cualquier ejercicio: se filtran acá. */
  logged: readonly SessionSet[];
  /** Las series de la vez pasada, igual. */
  previous: readonly SessionSet[];
}): ExercisePlan {
  const { item } = input;
  const done = bySetIndex(input.logged, item.exercise_id);
  const past = bySetIndex(input.previous, item.exercise_id);

  const rows = rowCount(item.target_sets, done, past.size);

  const sets: PlannedSet[] = [];
  for (let setIndex = 0; setIndex < rows; setIndex++) {
    sets.push({
      setIndex,
      done: done.get(setIndex) ?? null,
      previous: past.get(setIndex) ?? null,
    });
  }

  return {
    id: item.id,
    exerciseId: item.exercise_id,
    targetSets: item.target_sets,
    targetReps: item.target_reps,
    sets,
    doneCount: done.size,
  };
}

export function planWorkout(input: {
  items: readonly Pick<
    RoutineExercise,
    "id" | "exercise_id" | "target_sets" | "target_reps"
  >[];
  logged: readonly SessionSet[];
  previous: readonly SessionSet[];
}): ExercisePlan[] {
  return input.items.map((item) =>
    planExercise({ item, logged: input.logged, previous: input.previous }),
  );
}

/**
 * El primer número de un objetivo de reps. "8-12" → 8, "al fallo" → null.
 *
 * El primero y no el último: es el número al que uno se compromete, y
 * corregirlo hacia arriba después de hacer doce es un toque; descubrir que
 * quedó anotado doce cuando se hicieron ocho, en cambio, no se nota.
 */
export function parseTargetReps(targetReps: string | null): number | null {
  if (!targetReps) return null;
  const match = /\d+/.exec(targetReps);
  return match ? Number(match[0]) : null;
}

/** Con qué valores arranca una fila que todavía no se marcó. */
export function suggestFor(
  set: PlannedSet,
  targetReps: string | null,
): { reps: number | null; weightKg: number | null } {
  return {
    reps: set.done?.reps ?? set.previous?.reps ?? parseTargetReps(targetReps),
    weightKg: set.done?.weight_kg ?? set.previous?.weight_kg ?? null,
  };
}

export type WorkoutTotals = {
  doneSets: number;
  /** Las series que el día pide. Las filas de más no cuentan como pendientes. */
  plannedSets: number;
  /** Σ reps × kg de lo marcado. Las series sin peso no suman. */
  volumeKg: number;
};

export function workoutTotals(
  plans: readonly ExercisePlan[],
): WorkoutTotals {
  let doneSets = 0;
  let plannedSets = 0;
  let volumeKg = 0;

  for (const plan of plans) {
    doneSets += plan.doneCount;
    plannedSets += Math.max(plan.targetSets ?? 0, plan.doneCount);
    for (const set of plan.sets) {
      if (set.done?.reps && set.done.weight_kg) {
        volumeKg += set.done.reps * set.done.weight_kg;
      }
    }
  }

  return { doneSets, plannedSets, volumeKg };
}

/** "Empuje · 8 de 12 series". Lo que va arriba de todo mientras se entrena. */
export function progressLabel(totals: WorkoutTotals): string {
  if (!totals.plannedSets) return "Sin series todavía";
  return `${totals.doneSets} de ${totals.plannedSets} series`;
}
