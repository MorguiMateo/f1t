// `routine_days.weekday` uses 0 = Sunday like `Date#getDay()`, so "today" is a
// direct comparison; the week is still displayed Monday-first, like the heatmap.

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

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_ES[weekday] ?? "";
}

export function shortWeekdayLabel(weekday: number): string {
  return WEEKDAY_SHORT_ES[weekday] ?? "";
}

export function todayWeekday(now: Date = new Date()): number {
  return now.getDay();
}

type HasWeekday = { weekday: number };

export function dayForWeekday<T extends HasWeekday>(
  days: readonly T[],
  weekday: number,
): T | null {
  return days.find((day) => day.weekday === weekday) ?? null;
}

// Starts at tomorrow and wraps around, so a routine whose only day is today
// returns today with `inDays: 7` rather than null.
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

export function whenLabel(inDays: number, weekday: number): string {
  if (inDays === 1) return "mañana";
  if (inDays === 7) return `el ${weekdayLabel(weekday).toLowerCase()} que viene`;
  return `el ${weekdayLabel(weekday).toLowerCase()}`;
}
