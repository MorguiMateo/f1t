/**
 * Every read and write against `weight_entries`.
 *
 * Kept apart from `api.ts` — which is `body_profile` and its two
 * database-owned columns — because the two tables share nothing but the
 * feature folder. What they do share is the schema handling the identity:
 *
 * - **`user_id` is never sent.** It defaults to `auth.uid()` and the policy's
 *   `with check` rejects anything else.
 */

import { toDateKey } from "../../lib/heatmap";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";
import type { WeightEntry } from "./weight";

/**
 * Every measurement, newest first — the order the list reads and the order
 * `withDeltas` expects. There is at most one per day, so the whole series is a
 * handful of rows even after years; no range filter needed.
 */
export async function fetchWeightEntries(): Promise<WeightEntry[]> {
  return (
    unwrap(
      await supabase
        .from("weight_entries")
        .select("*")
        .order("measured_on", { ascending: false }),
    ) ?? []
  );
}

/**
 * Records a weight, correcting the day's entry if there already is one.
 *
 * It is an upsert on `(user_id, measured_on)` because weighing yourself twice
 * on the same day is a correction, not a second data point — same call as
 * `logSet`. `user_id` isn't sent: it defaults to `auth.uid()`, which Postgres
 * fills before it resolves the conflict, so `on conflict (user_id,
 * measured_on)` matches the existing row in one statement.
 */
export async function saveWeight(input: {
  measuredOn: string;
  weightKg: number;
}): Promise<WeightEntry> {
  return unwrapRow(
    await supabase
      .from("weight_entries")
      .upsert(
        { measured_on: input.measuredOn, weight_kg: input.weightKg },
        { onConflict: "user_id,measured_on" },
      )
      .select()
      .single(),
  );
}

/** Removes a mistyped measurement. */
export async function deleteWeightEntry(id: string): Promise<void> {
  unwrap(await supabase.from("weight_entries").delete().eq("id", id));
}

/** Today the way `measured_on` stores it: local, not UTC. */
export function today(): string {
  return toDateKey(new Date());
}
