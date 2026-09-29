import { toDateKey } from "../../lib/heatmap";
import { unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";
import type { WeightEntry } from "./weight";

/** Below Supabase's default 1,000-row API cap; fetch until a short page. */
export const WEIGHT_PAGE_SIZE = 500;

/** Keyset paging avoids shifting offsets if another weigh-in is written mid-read. */
export async function fetchWeightEntries(): Promise<WeightEntry[]> {
  const entries: WeightEntry[] = [];
  let before: string | null = null;
  for (;;) {
    // One row per user/day, so measured_on alone is a unique cursor under RLS.
    const query = supabase.from("weight_entries").select("*");
    const filtered: typeof query = before ? query.lt("measured_on", before) : query;
    const page: WeightEntry[] = unwrap(
      await filtered
        .order("measured_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(WEIGHT_PAGE_SIZE),
    ) ?? [];
    entries.push(...page);
    if (page.length < WEIGHT_PAGE_SIZE) return entries;
    before = page[page.length - 1].measured_on;
  }
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
