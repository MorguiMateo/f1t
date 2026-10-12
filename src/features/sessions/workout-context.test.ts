import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthQueryClient, setAuthQueryIdentity } from "../auth/auth-query-client";
import { createFrozenWorkoutPlans, fetchOwnedLoggedDay, includeRecordedExercises } from "./workout-context";
import type { RoutineDay } from "../routines/api";
import type { SessionDetail } from "./api";

const mocks = vi.hoisted(() => ({ select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: mocks.from } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const day: RoutineDay = { id: "old-day", user_id: "owner", routine_id: "inactive-routine", weekday: 1, label: "Piernas",
  exercises: [{ id: "item", user_id: "owner", routine_day_id: "old-day", exercise_id: "squat", position: 0,
    target_sets: 3, target_reps: "8", target_weight_kg: 70, notes: null }] };

beforeEach(() => {
  vi.clearAllMocks();
  setAuthQueryIdentity("owner");
  const chain = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle };
  mocks.from.mockReturnValue(chain); mocks.select.mockReturnValue(chain); mocks.eq.mockReturnValue(chain);
});

describe("owned logged-day resolution", () => {
  it("loads the inactive logged day with explicit owner and id filters, sorts and filters nested exercises", async () => {
    const { exercises, ...row } = day;
    mocks.maybeSingle.mockResolvedValue({ data: { ...row, routine_exercises: [
      { ...exercises[0], id: "later", position: 2 }, { ...exercises[0], id: "first", position: 0 },
      { ...exercises[0], id: "foreign", user_id: "another-owner" }, { ...exercises[0], id: "different-day", routine_day_id: "other-day" },
    ] }, error: null });
    const result = await fetchOwnedLoggedDay("owner", "old-day", createAuthQueryClient());
    expect(mocks.eq.mock.calls).toEqual([["id", "old-day"], ["user_id", "owner"]]);
    expect(result?.routine_id).toBe("inactive-routine");
    expect(result?.exercises.map(item => item.id)).toEqual(["first", "later"]);
  });

  it("refuses a late response after account replacement and never returns another owner's row", async () => {
    const response = deferred<{ data: unknown; error: null }>();
    mocks.maybeSingle.mockReturnValueOnce(response.promise);
    const result = fetchOwnedLoggedDay("owner", "old-day", createAuthQueryClient());
    setAuthQueryIdentity("replacement");
    response.resolve({ data: { ...day, routine_exercises: day.exercises }, error: null });
    await expect(result).rejects.toThrow("La sesión cambió");
    setAuthQueryIdentity("owner");
    mocks.maybeSingle.mockResolvedValue({ data: { ...day, user_id: "replacement", routine_exercises: day.exercises }, error: null });
    expect(await fetchOwnedLoggedDay("owner", "old-day", createAuthQueryClient())).toBeNull();
  });
});

describe("local frozen plan identity", () => {
  it("freezes original order/targets across routine edits and reloads, separately from registered values", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const first = createFrozenWorkoutPlans("owner", storage);
    first.freeze("2026-10-01", day, true);
    const changed = { ...day, label: "Nuevo nombre", exercises: day.exercises.map(item => ({ ...item, target_weight_kg: 100 })) };
    first.freeze("2026-10-01", changed, false);
    const reload = createFrozenWorkoutPlans("owner", storage);
    expect(reload.get("2026-10-01", "old-day")?.day.label).toBe("Piernas");
    expect(reload.get("2026-10-01", "old-day")?.day.exercises[0].target_weight_kg).toBe(70);
    expect(reload.get("2026-10-02", "old-day")).toBeNull();
    expect(reload.get("2026-10-01", "other-day")).toBeNull();
    expect(createFrozenWorkoutPlans("another-owner", storage).get("2026-10-01", "old-day")).toBeNull();
    expect([...data.values()][0]).not.toContain("session_sets");
    expect([...data.values()][0]).not.toContain("user_id");
  });

  it("keeps removed performed exercises without inventing their old routine target or exposing foreign sets", () => {
    const session: SessionDetail = { id: "session", user_id: "owner", performed_on: "2026-10-01", routine_day_id: "old-day", set_count: 2, created_at: "2026-10-01", notes: null,
      sets: [
        { id: "removed", session_id: "session", user_id: "owner", exercise_id: "removed-exercise", set_index: 0, reps: 8, weight_kg: 60 },
        { id: "foreign", session_id: "session", user_id: "other-owner", exercise_id: "foreign-exercise", set_index: 0, reps: 8, weight_kg: 60 },
      ] };
    const result = includeRecordedExercises(day, session, "owner");
    expect(result.exercises.map(item => item.exercise_id)).toEqual(["squat", "removed-exercise"]);
    expect(result.exercises[1]).toMatchObject({ id: "recorded:removed-exercise", target_reps: null, target_weight_kg: null });
  });
});
