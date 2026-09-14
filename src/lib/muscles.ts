/**
 * Traducción del vocabulario del dataset.
 *
 * free-exercise-db está en inglés y react-body-highlighter usa sus propios
 * nombres, que no coinciden. Acá viven las dos tablas: la que se muestra al
 * usuario (español) y la que alimenta el mapa corporal.
 *
 * Los vocabularios son cerrados y verificados contra el dataset y contra
 * `react-body-highlighter/dist/component/metadata.d.ts`, así que están
 * tipados: agregar un músculo que el dataset no tiene no compila.
 */

import type { Muscle } from "react-body-highlighter";

/** Los 17 músculos de free-exercise-db, tal como vienen en el JSON. */
export const MUSCLES = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const;

export type DatasetMuscle = (typeof MUSCLES)[number];

export const MUSCLE_ES: Record<DatasetMuscle, string> = {
  abdominals: "Abdominales",
  abductors: "Abductores",
  adductors: "Aductores",
  biceps: "Bíceps",
  calves: "Gemelos",
  chest: "Pecho",
  forearms: "Antebrazos",
  glutes: "Glúteos",
  hamstrings: "Isquiotibiales",
  lats: "Dorsales",
  "lower back": "Lumbares",
  "middle back": "Espalda media",
  neck: "Cuello",
  quadriceps: "Cuádriceps",
  shoulders: "Hombros",
  traps: "Trapecios",
  triceps: "Tríceps",
};

/**
 * Mapeo al vocabulario del mapa corporal. Los casos que no son 1:1:
 *
 * - `shoulders` se abre en deltoides anterior y posterior, porque el modelo
 *   los dibuja separados y el dataset no distingue.
 * - `lats` y `middle back` caen los dos en `upper-back`: el SVG no tiene una
 *   región para dorsales aparte. Se pierde precisión, no corrección.
 * - `traps` es `trapezius` y no `upper-back`, que sería lo intuitivo.
 */
export const MUSCLE_TO_BODY_PART: Record<DatasetMuscle, Muscle[]> = {
  abdominals: ["abs"],
  abductors: ["abductors"],
  adductors: ["adductor"],
  biceps: ["biceps"],
  calves: ["calves"],
  chest: ["chest"],
  forearms: ["forearm"],
  glutes: ["gluteal"],
  hamstrings: ["hamstring"],
  lats: ["upper-back"],
  "lower back": ["lower-back"],
  "middle back": ["upper-back"],
  neck: ["neck"],
  quadriceps: ["quadriceps"],
  shoulders: ["front-deltoids", "back-deltoids"],
  traps: ["trapezius"],
  triceps: ["triceps"],
};

/** Convierte una lista del dataset a regiones del modelo, sin repetir. */
export function toBodyParts(muscles: readonly string[]): Muscle[] {
  const parts = new Set<Muscle>();
  for (const m of muscles) {
    for (const part of MUSCLE_TO_BODY_PART[m as DatasetMuscle] ?? []) {
      parts.add(part);
    }
  }
  return [...parts];
}

export function muscleLabel(muscle: string): string {
  return MUSCLE_ES[muscle as DatasetMuscle] ?? muscle;
}

// ---------------------------------------------------------------------------
// Los otros vocabularios cerrados del dataset.
// ---------------------------------------------------------------------------

export const EQUIPMENT_ES: Record<string, string> = {
  "body only": "Peso corporal",
  barbell: "Barra",
  dumbbell: "Mancuernas",
  machine: "Máquina",
  cable: "Poleas",
  kettlebells: "Kettlebell",
  bands: "Bandas",
  "medicine ball": "Balón medicinal",
  "exercise ball": "Pelota suiza",
  "e-z curl bar": "Barra Z",
  "foam roll": "Foam roller",
  other: "Otro",
};

export const CATEGORY_ES: Record<string, string> = {
  strength: "Fuerza",
  stretching: "Elongación",
  plyometrics: "Pliometría",
  strongman: "Strongman",
  powerlifting: "Powerlifting",
  cardio: "Cardio",
  "olympic weightlifting": "Halterofilia",
};

export const LEVEL_ES: Record<string, string> = {
  beginner: "Principiante",
  intermediate: "Intermedio",
  expert: "Avanzado",
};

export const FORCE_ES: Record<string, string> = {
  push: "Empuje",
  pull: "Tracción",
  static: "Isométrico",
};

export const MECHANIC_ES: Record<string, string> = {
  compound: "Compuesto",
  isolation: "Aislamiento",
};

/** Para los campos que pueden venir null en el dataset. */
export function labelOr(
  table: Record<string, string>,
  value: string | null | undefined,
  fallback = "—",
): string {
  if (!value) return fallback;
  return table[value] ?? value;
}
