/**
 * Todo el acceso a las tablas `routine_*`.
 *
 * Acá no entra React: son funciones async sueltas y los hooks viven en
 * `queries.ts`. Así, el día que una rutina tenga que resolverse fuera de un
 * componente —armar el `WidgetPayload` de la Fase 6, por ejemplo— se llama a
 * la función y ya está.
 *
 * Tres cosas las resuelve el schema y por eso no aparecen en este archivo:
 *
 * - **`user_id` no se manda nunca.** Todas esas columnas tienen
 *   `default auth.uid()` y la policy `with check` rechaza lo ajeno. Mandarlo
 *   desde el cliente sería redundante y además una mentira sobre quién decide
 *   la identidad.
 * - **El borrado en cascada.** Borrar una rutina se lleva sus días, y borrar
 *   un día se lleva sus ejercicios.
 * - **La consistencia padre/hijo.** La FK compuesta `(routine_id, user_id)`
 *   hace que colgar un día de la rutina de otro sea un error de integridad.
 */

import type { Tables } from "../../lib/database.types";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type Routine = Tables<"routines">;
export type RoutineDayRow = Tables<"routine_days">;
export type RoutineExercise = Tables<"routine_exercises">;

/** Un día con sus ejercicios ya ordenados por `position`. */
export type RoutineDay = RoutineDayRow & { exercises: RoutineExercise[] };

/** Una rutina entera: lo que necesitan tanto el editor como la pestaña Hoy. */
export type RoutineDetail = Routine & { days: RoutineDay[] };

/** La fila de la lista: la rutina más cuántos días tiene. */
export type RoutineSummary = Routine & { dayCount: number };

// Una rutina entera son unos pocos KB, así que se trae en un solo viaje con
// los embeds anidados en lugar de tres queries encadenadas.
const DETAIL_SELECT =
  "*, routine_days(*, routine_exercises(*))";

type DetailRow = Routine & {
  routine_days: (RoutineDayRow & { routine_exercises: RoutineExercise[] })[];
};

/**
 * El orden se impone acá y no en la query.
 *
 * PostgREST sabe ordenar recursos embebidos, pero son siete días y un puñado
 * de ejercicios: ordenarlos en memoria es gratis y deja el orden escrito en
 * un lugar donde se lee, en vez de repartido en modificadores de la query.
 */
function toDetail(row: DetailRow): RoutineDetail {
  const { routine_days, ...routine } = row;
  return {
    ...routine,
    days: routine_days
      .map(({ routine_exercises, ...day }) => ({
        ...day,
        exercises: [...routine_exercises].sort((a, b) => a.position - b.position),
      }))
      .sort((a, b) => a.weekday - b.weekday),
  };
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function fetchRoutines(): Promise<RoutineSummary[]> {
  // `routine_days(count)` es un agregado de PostgREST: trae el número de días
  // sin traer los días. La lista no los necesita para nada más.
  const rows =
    unwrap(
      await supabase
        .from("routines")
        .select("*, routine_days(count)")
        .order("created_at", { ascending: true }),
    ) ?? [];

  return rows.map(({ routine_days, ...routine }) => ({
    ...routine,
    dayCount: routine_days[0]?.count ?? 0,
  }));
}

export async function fetchRoutineDetail(
  routineId: string,
): Promise<RoutineDetail | null> {
  const row = unwrap(
    await supabase
      .from("routines")
      .select(DETAIL_SELECT)
      .eq("id", routineId)
      .maybeSingle(),
  );
  return row ? toDetail(row) : null;
}

/**
 * La rutina activa, con todo adentro. Es la query de la pestaña Hoy.
 * `maybeSingle` y no `single`: no tener rutina activa es un estado normal,
 * no un error.
 */
export async function fetchActiveRoutine(): Promise<RoutineDetail | null> {
  const row = unwrap(
    await supabase
      .from("routines")
      .select(DETAIL_SELECT)
      .eq("is_active", true)
      .maybeSingle(),
  );
  return row ? toDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Rutinas
// ---------------------------------------------------------------------------

export async function createRoutine(input: {
  name: string;
  isActive: boolean;
}): Promise<Routine> {
  return unwrapRow(
    await supabase
      .from("routines")
      .insert({ name: input.name, is_active: input.isActive })
      .select()
      .single(),
  );
}

export async function renameRoutine(input: {
  routineId: string;
  name: string;
}): Promise<void> {
  unwrap(
    await supabase
      .from("routines")
      .update({ name: input.name })
      .eq("id", input.routineId),
  );
}

export async function deleteRoutine(routineId: string): Promise<void> {
  unwrap(await supabase.from("routines").delete().eq("id", routineId));
}

/**
 * Activar una rutina es apagar la anterior y prender esta, **en ese orden**.
 *
 * `routines_one_active_idx` es un índice único parcial sobre `user_id` where
 * `is_active`: si se prendiera primero, habría dos activas por un instante y
 * Postgres rechazaría el update. El `eq("is_active", true)` alcanza como
 * filtro porque RLS ya limita el update a las filas propias.
 */
export async function activateRoutine(routineId: string): Promise<void> {
  unwrap(
    await supabase
      .from("routines")
      .update({ is_active: false })
      .eq("is_active", true),
  );
  unwrap(
    await supabase
      .from("routines")
      .update({ is_active: true })
      .eq("id", routineId),
  );
}

// ---------------------------------------------------------------------------
// Días
// ---------------------------------------------------------------------------

export async function createDay(input: {
  routineId: string;
  weekday: number;
  label: string;
}): Promise<RoutineDayRow> {
  return unwrapRow(
    await supabase
      .from("routine_days")
      .insert({
        routine_id: input.routineId,
        weekday: input.weekday,
        label: input.label,
      })
      .select()
      .single(),
  );
}

export async function renameDay(input: {
  dayId: string;
  label: string;
}): Promise<void> {
  unwrap(
    await supabase
      .from("routine_days")
      .update({ label: input.label })
      .eq("id", input.dayId),
  );
}

export async function deleteDay(dayId: string): Promise<void> {
  unwrap(await supabase.from("routine_days").delete().eq("id", dayId));
}

// ---------------------------------------------------------------------------
// Ejercicios de un día
// ---------------------------------------------------------------------------

/**
 * Agrega al final. La posición se lee de la base y no del estado del cliente:
 * el ejercicio se elige desde el catálogo, que es otra pantalla, y arrastrar
 * hasta ahí la lista del día solo para contar sería peor.
 */
export async function addExerciseToDay(input: {
  dayId: string;
  exerciseId: string;
}): Promise<RoutineExercise> {
  const last = unwrap(
    await supabase
      .from("routine_exercises")
      .select("position")
      .eq("routine_day_id", input.dayId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  return unwrapRow(
    await supabase
      .from("routine_exercises")
      .insert({
        routine_day_id: input.dayId,
        exercise_id: input.exerciseId,
        position: (last?.position ?? -1) + 1,
      })
      .select()
      .single(),
  );
}

/**
 * Cambia series/reps/nota de un ejercicio de la rutina. El patch usa los
 * nombres de las columnas a propósito: una capa de traducción de nombres
 * para tres campos solo agrega un lugar más donde equivocarse.
 */
export async function updateRoutineExercise(input: {
  id: string;
  patch: {
    target_sets?: number | null;
    target_reps?: string | null;
    notes?: string | null;
  };
}): Promise<void> {
  unwrap(
    await supabase
      .from("routine_exercises")
      .update(input.patch)
      .eq("id", input.id),
  );
}

export async function removeRoutineExercise(id: string): Promise<void> {
  unwrap(await supabase.from("routine_exercises").delete().eq("id", id));
}

/**
 * Reordenar es intercambiar las posiciones de dos filas vecinas.
 *
 * No hay unique sobre `(routine_day_id, position)`, así que los dos updates
 * pueden ir en paralelo sin pasar por un valor temporal. Si uno fallara, el
 * peor caso es dos ejercicios con la misma posición: el orden queda raro, no
 * se pierde nada, y se arregla tocando otra vez la flecha.
 */
export async function swapExercisePositions(input: {
  a: { id: string; position: number };
  b: { id: string; position: number };
}): Promise<void> {
  const { a, b } = input;
  const [first, second] = await Promise.all([
    supabase
      .from("routine_exercises")
      .update({ position: b.position })
      .eq("id", a.id),
    supabase
      .from("routine_exercises")
      .update({ position: a.position })
      .eq("id", b.id),
  ]);
  unwrap(first);
  unwrap(second);
}
