import type { RoutineDay } from "../features/routines/api";
import type { SessionDetail } from "../features/sessions/api";
import { dayForWeekday } from "../features/routines/weekdays";

/** Once a session exists, never silently switch it to the weekday's plan. */
export function selectTodayDay(
  days: readonly RoutineDay[],
  weekday: number,
  session: Pick<SessionDetail, "routine_day_id"> | null | undefined,
): RoutineDay | null {
  if (session) return days.find((day) => day.id === session.routine_day_id) ?? null;
  return dayForWeekday(days, weekday);
}

/** Completion requires every planned index, not an aggregate count or extra sets. */
export function todayWorkoutProgress(day: RoutineDay, sets: SessionDetail["sets"]) {
  let completed = 0;
  let planned = 0;
  for (const item of day.exercises) {
    const goal = Math.max(1, item.target_sets ?? 1);
    const indexes = new Set(sets.filter((set) => set.exercise_id === item.exercise_id).map((set) => set.set_index));
    planned += goal;
    for (let index = 0; index < goal; index++) if (indexes.has(index)) completed++;
  }
  return { completed, planned, finished: planned > 0 && completed === planned };
}
