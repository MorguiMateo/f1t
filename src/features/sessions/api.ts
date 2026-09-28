/**
 * `user_id` is never sent: it defaults to `auth.uid()` and RLS rejects
 * anything else. `set_count` is kept by a trigger, not the client, so ticking a
 * set is one request and the heatmap can't drift when a second write fails.
 */

import type { Tables } from "../../lib/database.types";
import { toDateKey } from "../../lib/heatmap";
import { isUniqueViolation, unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type Session = Tables<"sessions">;
export type SessionSet = Tables<"session_sets">;

export type SessionDetail = Session & { sets: SessionSet[] };

/** Heatmap needs only per-day totals. See PLAN.md §5.2. */
export type SessionDay = Pick<Session, "performed_on" | "set_count">;

const DETAIL_SELECT = "*, session_sets(*)";

type DetailRow = Session & { session_sets: SessionSet[] };

function toDetail(row: DetailRow): SessionDetail {
  const { session_sets, ...session } = row;
  return { ...session, sets: session_sets };
}

/**
 * No set detail: the heatmap only needs two columns per day. `set_count > 0`
 * drops sessions whose sets were all unticked, so the heatmap, streak and day
 * counter agree on what counts as a day trained.
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

/** `maybeSingle`: not having trained yet is the normal state, not an error. */
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
 * Looked up by `routine_day_id`, not per exercise: one query instead of one per
 * exercise. Trade-off: a deleted and recreated day loses its history here.
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

/**
 * Two quick taps can both miss the select; the second insert then violates the
 * `(user_id, performed_on)` unique constraint, which just means the session
 * already exists, so read it back.
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

/** Upsert so re-ticking a set (e.g. to correct the weight) overwrites it instead of failing. */
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

export async function unlogSet(id: string): Promise<void> {
  unwrap(await supabase.from("session_sets").delete().eq("id", id));
}

export async function deleteSession(id: string): Promise<void> {
  unwrap(await supabase.from("sessions").delete().eq("id", id));
}

/** Local date, not UTC, matching how `performed_on` is stored. */
export function today(): string {
  return toDateKey(new Date());
}
