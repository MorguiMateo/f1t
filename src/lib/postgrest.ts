/**
 * The two helpers that turn a PostgREST response into something React Query
 * understands.
 *
 * The Supabase client returns `{ data, error }` and **never throws**. React
 * Query tells data from error by the exception, so without these two a
 * permissions failure reaches the screen as a silent "there's nothing here",
 * which is the worst way to fail: the app looks like it works.
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
 * The same, for writes that return the row they just wrote. A null there
 * isn't "there's nothing", it is an insert the policy let through whose
 * `returning` never came back: better to find out here.
 */
export function unwrapRow<T>(result: {
  data: T | null;
  error: PostgrestError | null;
}): T {
  const data = unwrap(result);
  if (data === null) throw new Error("La base no devolvió la fila escrita.");
  return data;
}

/** Unique violation. This is Postgres' code, not PostgREST's. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}
