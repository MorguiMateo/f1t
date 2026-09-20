/**
 * Los dos ayudantes que convierten la respuesta de PostgREST en algo que
 * React Query entienda.
 *
 * El cliente de Supabase devuelve `{ data, error }` y **nunca lanza**. React
 * Query distingue error de dato por la excepción, así que sin estas dos
 * funciones un fallo de permisos llega a la pantalla como un "no hay nada"
 * silencioso, que es la peor forma de fallar: parece que la app funciona.
 */

import type { PostgrestError } from "@supabase/supabase-js";

export function unwrap<T>(result: {
  data: T;
  error: PostgrestError | null;
}): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * Lo mismo, para las escrituras que devuelven la fila que acabaron de
 * escribir. Un null ahí no es "no hay nada", es un insert que la policy dejó
 * pasar pero cuyo `returning` no volvió: mejor enterarse acá.
 */
export function unwrapRow<T>(result: {
  data: T | null;
  error: PostgrestError | null;
}): T {
  const data = unwrap(result);
  if (data === null) throw new Error("La base no devolvió la fila escrita.");
  return data;
}

/** Violación de unique. Es el código de Postgres, no de PostgREST. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}
