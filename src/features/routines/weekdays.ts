/**
 * Los días de la semana.
 *
 * `routine_days.weekday` usa 0 = domingo, igual que `Date#getDay()`: así
 * "qué toca hoy" es una comparación directa, sin conversiones que se
 * desfasan en algún borde. Pero la semana se **muestra** empezando el lunes,
 * que es como se piensa una rutina —y como ya arranca la semana el heatmap,
 * con `weekStartsOn: 1`—. Esas dos cosas conviven acá y en ningún otro lado.
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

/** El orden en que se dibuja la semana: de lunes a domingo. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_ES[weekday] ?? "";
}

export function shortWeekdayLabel(weekday: number): string {
  return WEEKDAY_SHORT_ES[weekday] ?? "";
}

/** 0 = domingo, en hora local. */
export function todayWeekday(now: Date = new Date()): number {
  return now.getDay();
}

type HasWeekday = { weekday: number };

/** El día de rutina que cae en ese weekday, o null si es descanso. */
export function dayForWeekday<T extends HasWeekday>(
  days: readonly T[],
  weekday: number,
): T | null {
  return days.find((day) => day.weekday === weekday) ?? null;
}

/**
 * El próximo día con entrenamiento mirando hacia adelante.
 *
 * Empieza en mañana y da la vuelta completa, así que si el único día de la
 * rutina es hoy devuelve hoy con `inDays: 7` —la semana que viene— y no null.
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

/** Cómo se dice "en tantos días" sin escribir una fecha: "mañana", "el jueves". */
export function whenLabel(inDays: number, weekday: number): string {
  if (inDays === 1) return "mañana";
  if (inDays === 7) return `el ${weekdayLabel(weekday).toLowerCase()} que viene`;
  return `el ${weekdayLabel(weekday).toLowerCase()}`;
}
