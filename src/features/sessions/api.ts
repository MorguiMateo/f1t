/**
 * Todo el acceso a `sessions` y `session_sets`.
 *
 * Mismo reparto que en `routines/`: acá no entra React, los hooks viven en
 * `queries.ts`. Y dos cosas que resuelve el schema y por eso no aparecen
 * escritas acá:
 *
 * - **`user_id` no se manda nunca.** Default `auth.uid()` y `with check` en
 *   la policy.
 * - **`set_count` no se calcula en el cliente.** Lo recalcula un trigger en
 *   cada insert y delete de `session_sets` (migración
 *   `20260920104500_session_set_count.sql`). Es la columna que lee el
 *   heatmap: si la mantuviera el cliente, marcar una serie serían dos
 *   requests y la intensidad mentiría cada vez que el segundo falle.
 */

import type { Tables } from "../../lib/database.types";
import { toDateKey } from "../../lib/heatmap";
import { isUniqueViolation, unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type Session = Tables<"sessions">;
export type SessionSet = Tables<"session_sets">;

/** Una sesión con su detalle serie por serie. */
export type SessionDetail = Session & { sets: SessionSet[] };

/** Lo mínimo que el heatmap necesita de cada día. Ver PLAN.md §5.2. */
export type SessionDay = Pick<Session, "performed_on" | "set_count">;

const DETAIL_SELECT = "*, session_sets(*)";

type DetailRow = Session & { session_sets: SessionSet[] };

function toDetail(row: DetailRow): SessionDetail {
  const { session_sets, ...session } = row;
  return { ...session, sets: session_sets };
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/**
 * Los días entrenados desde una fecha, sin el detalle.
 *
 * El heatmap de 26 semanas son 182 filas como mucho —una por día entrenado—
 * y de cada una alcanzan dos columnas. Traer el detalle sería traer cientos
 * de series para dibujar cuadraditos de 10 píxeles.
 *
 * `set_count > 0` deja afuera las sesiones vacías: abrir la pantalla de
 * entrenar y marcar una serie que después se desmarca deja una fila con cero
 * series, y eso no es un día entrenado. Sin el filtro, el cuadradito saldría
 * en nivel 0 pero la racha y el contador de días lo sumarían igual, que es
 * la clase de desacuerdo que hace desconfiar de todo el resto.
 */
export async function fetchSessionDays(since: string): Promise<SessionDay[]> {
  return (
    unwrap(
      await supabase
        .from("sessions")
        .select("performed_on, set_count")
        .gte("performed_on", since)
        .gt("set_count", 0)
        .order("performed_on", { ascending: true }),
    ) ?? []
  );
}

/**
 * La sesión de un día con todas sus series.
 * `maybeSingle`: no haber entrenado todavía es el estado normal, no un error.
 */
export async function fetchSessionForDate(
  performedOn: string,
): Promise<SessionDetail | null> {
  const row = unwrap(
    await supabase
      .from("sessions")
      .select(DETAIL_SELECT)
      .eq("performed_on", performedOn)
      .maybeSingle(),
  );
  return row ? toDetail(row) : null;
}

/**
 * La última vez que se entrenó **este mismo día de rutina**, para poder
 * mostrar con cuánto peso se hizo cada serie.
 *
 * Se busca por `routine_day_id` y no por ejercicio: "la vez pasada que hice
 * Empuje" es la comparación que se hace en el gimnasio, y sale en una sola
 * query en lugar de una por ejercicio. Si el día se borró y se volvió a
 * crear, el historial viejo cuelga de otro id y acá no aparece: es el precio
 * de no salir a buscar por ejercicio suelto, y el peso se vuelve a escribir
 * una vez.
 */
export async function fetchPreviousSession(input: {
  routineDayId: string;
  before: string;
}): Promise<SessionDetail | null> {
  const row = unwrap(
    await supabase
      .from("sessions")
      .select(DETAIL_SELECT)
      .eq("routine_day_id", input.routineDayId)
      .lt("performed_on", input.before)
      .order("performed_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? toDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/**
 * La sesión de hoy, creándola si hace falta.
 *
 * `sessions_one_per_day` es un unique sobre `(user_id, performed_on)`, así
 * que dos toques rápidos antes de que llegue la primera respuesta hacen que
 * el segundo insert reviente con 23505. Eso no es un error que mostrarle a
 * nadie: significa que la sesión ya existe, que es exactamente lo que se
 * quería. Se vuelve a leer y listo.
 */
export async function ensureSession(input: {
  performedOn: string;
  routineDayId: string | null;
}): Promise<Session> {
  const existing = unwrap(
    await supabase
      .from("sessions")
      .select("*")
      .eq("performed_on", input.performedOn)
      .maybeSingle(),
  );
  if (existing) return existing;

  const created = await supabase
    .from("sessions")
    .insert({
      performed_on: input.performedOn,
      routine_day_id: input.routineDayId,
    })
    .select()
    .single();

  if (isUniqueViolation(created.error)) {
    return unwrapRow(
      await supabase
        .from("sessions")
        .select("*")
        .eq("performed_on", input.performedOn)
        .maybeSingle(),
    );
  }

  return unwrapRow(created);
}

/**
 * Marca una serie como hecha.
 *
 * Es un upsert y no un insert por el mismo motivo que arriba: la unique es
 * `(session_id, exercise_id, set_index)` y re-marcar la misma serie tiene
 * que pisar el valor anterior, no fallar. Así, corregir el peso de una serie
 * ya marcada es volver a llamar acá.
 */
export async function logSet(input: {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  reps: number | null;
  weightKg: number | null;
}): Promise<SessionSet> {
  return unwrapRow(
    await supabase
      .from("session_sets")
      .upsert(
        {
          session_id: input.sessionId,
          exercise_id: input.exerciseId,
          set_index: input.setIndex,
          reps: input.reps,
          weight_kg: input.weightKg,
        },
        { onConflict: "session_id,exercise_id,set_index" },
      )
      .select()
      .single(),
  );
}

/** Desmarcar una serie es borrar la fila: el trigger baja el `set_count`. */
export async function unlogSet(id: string): Promise<void> {
  unwrap(await supabase.from("session_sets").delete().eq("id", id));
}

/**
 * Borra el entrenamiento entero. Las series se van en cascada por la FK
 * compuesta `(session_id, user_id)`.
 */
export async function deleteSession(id: string): Promise<void> {
  unwrap(await supabase.from("sessions").delete().eq("id", id));
}

/** La fecha de hoy tal como la guarda `performed_on`: local, no UTC. */
export function today(): string {
  return toDateKey(new Date());
}
