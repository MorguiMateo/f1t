/**
 * El catálogo, servido desde el bundle y no desde Supabase.
 *
 * La tabla `exercises` existe en Postgres porque routine_exercises tiene una
 * FK contra ella, pero para *navegar* el catálogo la app lee este JSON, que
 * viaja dentro del bundle. Dos razones:
 *
 * - Offline en el gimnasio, que es donde peor anda el WiFi. Buscar un
 *   ejercicio no puede depender de la señal.
 * - Es instantáneo: 165 ejercicios filtrados en memoria no justifican un
 *   round-trip ni un estado de carga.
 *
 * Se regenera con `node scripts/fetch-exercises.mjs`.
 */

import raw from "./catalog.json";

export type Exercise = {
  id: string;
  /** Nombre visible por defecto, en español. */
  name: string;
  /** Nombre en inglés acortado. Lo consumirá el selector de idioma (PLAN.md). */
  nameEn: string;
  /** Variantes buscables (ES/EN) + el nombre crudo del dataset. No se muestra. */
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

// El cast evita que TS infiera el tipo literal de un JSON de 184 KB, que
// hace lento el typecheck sin aportar nada.
export const EXERCISES = raw as Exercise[];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/** Sin acentos y en minúsculas, para que "biceps" encuentre "Bíceps". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type CatalogFilters = {
  query?: string;
  /** Músculo del dataset ("chest"), no la etiqueta en español. */
  muscle?: string | null;
  equipment?: string | null;
};

/**
 * La búsqueda tiene que funcionar en los dos idiomas: el nombre visible está
 * en español, pero mucha gente escribe en inglés ("bench press") y al revés
 * ("press banca", "pecho plano"). Por eso el índice junta, además del nombre
 * español, el nombre en inglés y los alias curados a mano (que ya incluyen el
 * nombre crudo del dataset), más las etiquetas de músculos y equipamiento en
 * los dos idiomas.
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
  // Una consulta de varias palabras pide que estén todas, en cualquier orden.
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

/** Los músculos presentes en el catálogo, para no ofrecer filtros vacíos. */
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
