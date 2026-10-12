import { describe, expect, it } from "vitest";
import type { RoutineDay } from "../features/routines/api";
import type { SessionDetail, SessionSet } from "../features/sessions/api";
import { selectTodayDay, todayWorkoutProgress } from "./today-selection";

const day = (id: string, weekday: number, targetSets: number | null = 2): RoutineDay => ({
  id, weekday, routine_id: "routine", user_id: "owner", label: id,
  exercises: [{ id: `${id}-item`, user_id: "owner", routine_day_id: id, exercise_id: id,
    position: 0, target_sets: targetSets, target_reps: null, target_weight_kg: null, notes: null }],
});
const set = (exercise: string, index: number): SessionSet => ({ id: `${exercise}-${index}`, user_id: "owner", session_id: "session", exercise_id: exercise, set_index: index, reps: null, weight_kg: null });

describe("Today's session takes precedence over the calendar", () => {
  const days = [day("legs", 1), day("push", 2)];
  it("uses the weekday only before a session exists", () => {
    expect(selectTodayDay(days, 2, null)?.id).toBe("push");
  });
  it("resumes the recorded day, even on a rest day", () => {
    expect(selectTodayDay(days, 2, { routine_day_id: "legs" })?.id).toBe("legs");
    expect(selectTodayDay(days, 5, { routine_day_id: "legs" })?.id).toBe("legs");
  });
  it("never swaps a deleted, inactive or unlinked session to today's plan", () => {
    expect(selectTodayDay(days, 2, { routine_day_id: "removed" })).toBeNull();
    expect(selectTodayDay(days, 2, { routine_day_id: null })).toBeNull();
    expect(selectTodayDay([], 2, { routine_day_id: "legs" })).toBeNull();
  });
  it("reports a real rest day without a session", () => {
    expect(selectTodayDay(days, 5, null)).toBeNull();
  });
});

describe("Today's honest completion", () => {
  it("requires all planned indexes, not extra, duplicate or unrelated sets", () => {
    const plan = day("legs", 1);
    expect(todayWorkoutProgress(plan, [set("legs", 0), set("legs", 0), set("legs", 4), set("push", 1)])).toEqual({ completed: 1, planned: 2, finished: false });
    expect(todayWorkoutProgress(plan, [set("legs", 0), set("legs", 1)])).toEqual({ completed: 2, planned: 2, finished: true });
  });
  it("requires at least one explicit set for an unspecified or zero target", () => {
    for (const target of [null, 0]) {
      const plan = day("legs", 1, target);
      expect(todayWorkoutProgress(plan, []).finished).toBe(false);
      expect(todayWorkoutProgress(plan, [set("legs", 0)]).finished).toBe(true);
    }
  });
  it("does not call an empty plan complete", () => {
    expect(todayWorkoutProgress({ ...day("empty", 1), exercises: [] }, [] as SessionDetail["sets"]).finished).toBe(false);
  });
});
