/**
 * The days of the week.
 *
 * `routine_days.weekday` uses 0 = Sunday, same as `Date#getDay()`: that way
 * "what's on today" is a direct comparison, with no conversions to drift out
 * of sync at some edge. But the week is **displayed** starting on Monday,
 * which is how you think about a routine — and how the heatmap's week
 * already starts, with `weekStartsOn: 1`. Those two live together here and
 * nowhere else.
 */

export const WEEKDAY_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export const WEEKDAY_SHORT_ES = [
  "Dom",
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
] as const;

/** The order the week is drawn in: Monday through Sunday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_ES[weekday] ?? "";
}

export function shortWeekdayLabel(weekday: number): string {
  return WEEKDAY_SHORT_ES[weekday] ?? "";
}

/** 0 = Sunday, in local time. */
export function todayWeekday(now: Date = new Date()): number {
  return now.getDay();
}

type HasWeekday = { weekday: number };

/** The routine day falling on that weekday, or null if it's a rest day. */
export function dayForWeekday<T extends HasWeekday>(
  days: readonly T[],
  weekday: number,
): T | null {
  return days.find((day) => day.weekday === weekday) ?? null;
}

/**
 * The next training day, looking forward.
 *
 * It starts at tomorrow and goes all the way around, so if the routine's
 * only day is today it returns today with `inDays: 7` — next week — rather
 * than null.
 */
export function nextTrainingDay<T extends HasWeekday>(
  days: readonly T[],
  from: number = todayWeekday(),
): { day: T; inDays: number } | null {
  for (let inDays = 1; inDays <= 7; inDays++) {
    const day = dayForWeekday(days, (from + inDays) % 7);
    if (day) return { day, inDays };
  }
  return null;
}

/** How to say "in N days" without writing a date: "mañana", "el jueves". */
export function whenLabel(inDays: number, weekday: number): string {
  if (inDays === 1) return "mañana";
  if (inDays === 7) return `el ${weekdayLabel(weekday).toLowerCase()} que viene`;
  return `el ${weekdayLabel(weekday).toLowerCase()}`;
}
