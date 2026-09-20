/**
 * The catalog, served from the bundle and not from Supabase.
 *
 * The `exercises` table exists in Postgres because routine_exercises has an
 * FK against it, but to *browse* the catalog the app reads this JSON, which
 * travels inside the bundle. Two reasons:
 *
 * - Offline at the gym, which is where the WiFi is worst. Looking up an
 *   exercise cannot depend on reception.
 * - It is instant: 165 exercises filtered in memory justify neither a round
 *   trip nor a loading state.
 *
 * Regenerated with `node scripts/fetch-exercises.mjs`.
 */

import raw from "./catalog.json";

export type Exercise = {
  id: string;
  /** Default display name, in Spanish. */
  name: string;
  /** Shortened English name. The language switcher will consume it (PLAN.md). */
  nameEn: string;
  /** Searchable variants (ES/EN) + the dataset's raw name. Never displayed. */
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

// The cast stops TS from inferring the literal type of a 184 KB JSON file,
// which slows down typechecking without buying anything.
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

/**
 * Search has to work in both languages: the display name is in Spanish, but
 * plenty of people type English ("bench press") and the other way round
 * ("press banca", "pecho plano"). So the index gathers, on top of the
 * Spanish name, the English name and the hand-curated aliases (which already
 * include the dataset's raw name), plus muscle and equipment labels in both
 * languages.
 */
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
  // A multi-word query requires all of them, in any order.
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

/** The muscles present in the catalog, so no empty filters get offered. */
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
