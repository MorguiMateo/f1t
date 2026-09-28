/**
 * Browsing reads this bundled JSON, not Supabase (whose `exercises` table only
 * exists for routine_exercises' FK): it works offline at the gym and needs no
 * loading state. Regenerate with `node scripts/fetch-exercises.mjs`.
 */

import raw from "./catalog.json";

export type Exercise = {
  id: string;
  /** Spanish. */
  name: string;
  /** Reserved for the planned language switcher. */
  nameEn: string;
  /** Search-only, never displayed. */
  aliases: string[];
  category: string;
  equipment: string | null;
  level: string;
  force: string | null;
  mechanic: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  images: string[];
};

// Avoids inferring the literal type of a 184 KB JSON, which slows typechecking.
export const EXERCISES = raw as Exercise[];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/** Lowercased and unaccented, so "biceps" finds "Bíceps". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type CatalogFilters = {
  query?: string;
  /** The dataset's muscle ("chest"), not the Spanish label. */
  muscle?: string | null;
  equipment?: string | null;
};

/** Bilingual on purpose: plenty of people type "bench press" in a Spanish UI. */
export function buildSearchIndex(
  exercise: Exercise,
  muscleLabel: (m: string) => string,
  equipmentLabel: (e: string | null) => string,
): string {
  return normalize(
    [
      exercise.name,
      exercise.nameEn,
      ...exercise.aliases,
      ...exercise.primaryMuscles.map(muscleLabel),
      ...exercise.secondaryMuscles.map(muscleLabel),
      ...exercise.primaryMuscles,
      equipmentLabel(exercise.equipment),
      exercise.equipment ?? "",
    ].join(" "),
  );
}

export function filterExercises(
  exercises: readonly Exercise[],
  filters: CatalogFilters,
  searchIndex?: Map<string, string>,
): Exercise[] {
  const query = normalize(filters.query?.trim() ?? "");
  const terms = query ? query.split(/\s+/) : [];

  return exercises.filter((e) => {
    if (filters.equipment && e.equipment !== filters.equipment) return false;

    if (filters.muscle) {
      const hits =
        e.primaryMuscles.includes(filters.muscle) ||
        e.secondaryMuscles.includes(filters.muscle);
      if (!hits) return false;
    }

    if (!terms.length) return true;
    const haystack = searchIndex?.get(e.id) ?? normalize(e.name);
    return terms.every((t) => haystack.includes(t));
  });
}

/** So no empty filters get offered. */
export function availableMuscles(exercises: readonly Exercise[]): string[] {
  const set = new Set<string>();
  for (const e of exercises) for (const m of e.primaryMuscles) set.add(m);
  return [...set];
}

export function availableEquipment(exercises: readonly Exercise[]): string[] {
  const set = new Set<string>();
  for (const e of exercises) if (e.equipment) set.add(e.equipment);
  return [...set].sort();
}
