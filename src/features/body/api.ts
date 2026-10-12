/**
 * `user_id` is never sent: it defaults to `auth.uid()` and the policy's
 * `with check` rejects anything else. `updated_at` is set by a trigger.
 */

import type { Tables, TablesUpdate } from "../../lib/database.types";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";
import { fromDateKey, toDateKey } from "../../lib/heatmap";

export type BodyProfile = Tables<"body_profile">;

export type BodyProfilePatch = Pick<
  TablesUpdate<"body_profile">,
  "height_cm" | "birth_date" | "sex" | "goal" | "target_weight_kg"
>;

/**
 * `maybeSingle`: a new account has no row, and nothing creates one up front
 * because signing in shouldn't write anything.
 */
export async function fetchBodyProfile(): Promise<BodyProfile | null> {
  return unwrap(await supabase.from("body_profile").select("*").maybeSingle());
}

/**
 * An upsert avoids a read-then-write race. The patch carries only the edited
 * field, so two quick blurs can't overwrite each other with stale values.
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

/** Only the 28 local calendar days energyReport considers, even for old diary dates. */
export async function fetchEnergySessionDays(date: string): Promise<{ performed_on: string }[]> {
  const day = fromDateKey(date);
  const start = toDateKey(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 27));
  return unwrap(await supabase.from("sessions").select("performed_on")
    .gte("performed_on", start).lte("performed_on", date)
    .gt("set_count", 0)) ?? [];
}
