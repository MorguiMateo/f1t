/**
 * Every read and write against `sessions` and `session_sets`.
 *
 * Same split as `routines/`: no React in here, the hooks live in
 * `queries.ts`. And two things the schema handles, which is why they aren't
 * spelled out below:
 *
 * - **`user_id` is never sent.** It defaults to `auth.uid()` and the policy's
 *   `with check` rejects anything else.
 * - **`set_count` is not computed on the client.** A trigger recomputes it on
 *   every insert and delete of `session_sets` (migration
 *   `20260920104500_session_set_count.sql`). It is the column the heatmap
 *   reads: if the client owned it, ticking a set would be two requests and
 *   the intensity would lie every time the second one failed.
 */

import type { Tables } from "../../lib/database.types";
import { toDateKey } from "../../lib/heatmap";
import { isUniqueViolation, unwrap, unwrapRow } from "../../lib/postgrest";
import { supabase } from "../../lib/supabase";

export type Session = Tables<"sessions">;
export type SessionSet = Tables<"session_sets">;

/** A session with its set-by-set detail. */
export type SessionDetail = Session & { sets: SessionSet[] };

/** The bare minimum the heatmap needs per day. See PLAN.md §5.2. */
export type SessionDay = Pick<Session, "performed_on" | "set_count">;

const DETAIL_SELECT = "*, session_sets(*)";

type DetailRow = Session & { session_sets: SessionSet[] };

function toDetail(row: DetailRow): SessionDetail {
  const { session_sets, ...session } = row;
  return { ...session, sets: session_sets };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The days trained since a given date, without the detail.
 *
 * A 26-week heatmap is at most 182 rows — one per day trained — and two
 * columns of each are enough. Fetching the detail would mean fetching
 * hundreds of sets to draw 10-pixel squares.
 *
 * `set_count > 0` leaves out empty sessions: opening the workout screen and
 * ticking a set you then untick leaves a row with zero sets, and that is not
 * a day trained. Without the filter the square would render at level 0 while
 * the streak and the day counter still counted it — exactly the kind of
 * disagreement that makes you distrust everything else on the screen.
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
 * One day's session with all of its sets.
 * `maybeSingle`: not having trained yet is the normal state, not an error.
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
 * The last time **this same routine day** was trained, so each set can show
 * the weight it was done with.
 *
 * It looks up by `routine_day_id` and not by exercise: "last time I did Push"
 * is the comparison you make at the gym, and it comes back in a single query
 * instead of one per exercise. If the day was deleted and recreated, the old
 * history hangs off a different id and won't show up here: that is the price
 * of not going hunting exercise by exercise, and the weight gets typed in
 * once.
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
// Writes
// ---------------------------------------------------------------------------

/**
 * Today's session, creating it if it doesn't exist yet.
 *
 * `sessions_one_per_day` is a unique constraint on `(user_id, performed_on)`,
 * so two quick taps before the first response lands make the second insert
 * blow up with 23505. That is not an error to show anyone: it means the
 * session already exists, which is exactly what we wanted. Read it back and
 * move on.
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
 * Ticks a set as done.
 *
 * It is an upsert and not an insert for the same reason as above: the unique
 * constraint is `(session_id, exercise_id, set_index)`, and re-ticking the
 * same set has to overwrite the previous value, not fail. So correcting the
 * weight on an already-ticked set is just calling this again.
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

/** Unticking a set deletes the row: the trigger brings `set_count` down. */
export async function unlogSet(id: string): Promise<void> {
  unwrap(await supabase.from("session_sets").delete().eq("id", id));
}

/**
 * Deletes the whole workout. The sets go with it, cascaded by the composite
 * FK `(session_id, user_id)`.
 */
export async function deleteSession(id: string): Promise<void> {
  unwrap(await supabase.from("sessions").delete().eq("id", id));
}

/** Today's date the way `performed_on` stores it: local, not UTC. */
export function today(): string {
  return toDateKey(new Date());
}
