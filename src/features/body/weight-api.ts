import { toDateKey } from "../../lib/heatmap";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";
import type { WeightEntry } from "./weight";

/**
 * Newest first, the order `withDeltas` expects. At most one row per day, so
 * no range filter is needed even after years.
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
 * A second weigh-in the same day is a correction, not a new point. `user_id`
 * isn't sent: its `auth.uid()` default is filled before the conflict resolves.
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

export async function deleteWeightEntry(id: string): Promise<void> {
  unwrap(await supabase.from("weight_entries").delete().eq("id", id));
}

/** Local, not UTC, the way `measured_on` stores it. */
export function today(): string {
  return toDateKey(new Date());
}
