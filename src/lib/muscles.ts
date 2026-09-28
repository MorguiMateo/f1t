/**
 * The vocabularies are closed and verified against free-exercise-db and
 * `react-body-highlighter/dist/component/metadata.d.ts`, so they are typed:
 * a muscle the dataset doesn't have won't compile.
 */

import type { Muscle } from "react-body-highlighter";

/** Exactly as they come in the dataset JSON. */
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
 * Not 1:1: the dataset doesn't split front/back deltoids, the SVG has no lats
 * region (so lats and middle back share `upper-back`), and traps is
 * `trapezius`, not the intuitive `upper-back`.
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

export function labelOr(
  table: Record<string, string>,
  value: string | null | undefined,
  fallback = "—",
): string {
  if (!value) return fallback;
  return table[value] ?? value;
}
