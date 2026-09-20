/**
 * Qué músculos cubre una rutina —o un día— y cuáles se está dejando afuera.
 *
 * Es la única pieza de la Fase 3 que dice algo que el usuario no escribió:
 * mirando una lista de ejercicios no se ve que falta espalda, pero mirando
 * el muñeco sí.
 *
 * Lee el catálogo del bundle, así que este módulo arrastra `catalog.json`:
 * solo puede importarse desde pantallas que ya estén en un chunk `lazy()`.
 */

import { getExercise } from "../exercises/catalog";
import { MUSCLES, type DatasetMuscle } from "../../lib/muscles";

/**
 * Los grupos que una rutina equilibrada debería tocar. 
 *
 * El "falta" se calcula solo sobre estos y no sobre los 17 del dataset.
 * Cuello, abductores, aductores y antebrazos casi nunca se entrenan directo
 * —el dataset tiene dos ejercicios de cuello en total—, así que aparecerían
 * como deuda en absolutamente todas las rutinas y el aviso dejaría de
 * significar algo. Sí se muestran como cubiertos cuando aparecen.
 */
export const KEY_MUSCLES = [
  "abdominals",
  "biceps",
  "calves",
  "chest",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const satisfies readonly DatasetMuscle[];

export type Coverage = {
    /** Trabajados como primarios por al menos un ejercicio. */
  primary: DatasetMuscle[];
  /** Solo como secundarios: se tocan, pero nadie los entrena de frente. */
  secondary: DatasetMuscle[];
  /** Grupos grandes que no aparecen ni como primarios ni como secundarios. */
  missing: DatasetMuscle[];
  /** Ejercicios que sí se encontraron en el catálogo. */
  exerciseCount: number;
};

/**
 * Los tres conjuntos son disjuntos: un músculo primario no vuelve a contarse
 * como secundario. Es la misma regla que usa `MuscleMap` para no sumar
 * frecuencias y pasarse de rango.
 */

export function muscleCoverage(exerciseIds: readonly string[]): Coverage {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  let exerciseCount = 0;

  for (const id of exerciseIds) {
    const exercise = getExercise(id);
    // Un id que ya no está en el catálogo curado no rompe la pantalla: la
    // fila sigue en la base y acá simplemente no aporta músculos.
    if (!exercise) continue;
    exerciseCount++;
    for (const muscle of exercise.primaryMuscles) primary.add(muscle);
    for (const muscle of exercise.secondaryMuscles) secondary.add(muscle);
  }

  // En el orden anatómico de MUSCLES y no en el de aparición: así dos
  // rutinas parecidas se leen igual.
  const inOrder = (set: Set<string>) => MUSCLES.filter((m) => set.has(m));

  return {
    primary: inOrder(primary),
    secondary: inOrder(secondary).filter((m) => !primary.has(m)),
    missing: KEY_MUSCLES.filter((m) => !primary.has(m) && !secondary.has(m)),
    exerciseCount,
  };
}

/** Todos los ejercicios de una rutina, en un solo array plano. */
  export function exerciseIdsOf(
    days: readonly { exercises: readonly { exercise_id: string }[] }[],
  ): string[] {
    return days.flatMap((day) => day.exercises.map((e) => e.exercise_id));
  }
