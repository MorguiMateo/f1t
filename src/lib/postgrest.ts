/**
 * The Supabase client never throws, but React Query detects errors by
 * exception; without these, a permissions failure shows up as an empty list.
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
 * For writes that return their row: null means the policy let the write
 * through but its `returning` was hidden, not "nothing".
 */
export function unwrapRow<T>(result: {
  data: T | null;
  error: PostgrestError | null;
}): T {
  const data = unwrap(result);
  if (data === null) throw new Error("La base no devolvió la fila escrita.");
  return data;
}

// Postgres error code for unique constraint violation.
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}
