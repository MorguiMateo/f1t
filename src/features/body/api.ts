/**
 * Every read and write against `body_profile`.
 *
 * Same split as `routines/` and `sessions/`: plain async functions here, the
 * React Query hooks in `queries.ts`. And the same two things the schema
 * handles, which is why they don't appear below:
 *
 * - **`user_id` is never sent.** It is the primary key and it defaults to
 *   `auth.uid()`, so the row identifies itself. The policy's `with check`
 *   rejects anything else.
 * - **`updated_at` is never sent.** A trigger sets it on every update
 *   (`20260922090000_body_profile_updated_at.sql`).
 */

import type { Tables, TablesUpdate } from "../../lib/database.types";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type BodyProfile = Tables<"body_profile">;

/** What the form can change. The other two columns belong to the database. */
export type BodyProfilePatch = Pick<
  TablesUpdate<"body_profile">,
  "height_cm" | "birth_date" | "sex" | "goal" | "target_weight_kg"
>;

/**
 * The profile, or null if it was never filled in.
 *
 * `maybeSingle`: a brand-new account has no row here, and that is the normal
 * first state rather than an error. Nothing creates the row up front —
 * signing in shouldn't write anything, and an all-null row is
 * indistinguishable from no row anyway.
 */
export async function fetchBodyProfile(): Promise<BodyProfile | null> {
  return unwrap(await supabase.from("body_profile").select("*").maybeSingle());
}

/**
 * Writes the fields that changed, creating the row on the first save.
 *
 * It is an upsert rather than an insert-or-update decided here, because
 * deciding here means reading first and then racing anyone else who read at
 * the same moment. Postgres already knows whether the row exists: the
 * primary key is `user_id`, so `on conflict (user_id)` resolves it in one
 * statement.
 *
 * The patch carries only the field that was edited, and that is deliberate.
 * Sending the whole form on every blur means the values React Query last
 * handed the inputs get written back on top of whatever a parallel save just
 * stored; sending one column means two fields blurred in quick succession
 * land in either order with the same result.
 */
export async function saveBodyProfile(
  patch: BodyProfilePatch,
): Promise<BodyProfile> {
  return unwrapRow(
    await supabase
      .from("body_profile")
      .upsert(patch, { onConflict: "user_id" })
      .select()
      .single(),
  );
}
