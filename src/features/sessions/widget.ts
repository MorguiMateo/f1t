/**
 * El `WidgetPayload` que lee el widget de iOS.
 *
 * Todavía no hay widget: en web, `device.syncWidget()` solo deja el payload
 * en localStorage. Se arma igual, y completo, desde la Fase 4 —y no recién
 * en la Fase 6— por dos motivos: obliga a que `buildLevels()` tenga un
 * consumidor real desde el primer día, y cuando llegue Capacitor el lado web
 * ya está hecho. Ver PLAN.md §5.3.
 *
 * Es una función pura a propósito: los nombres de los ejercicios los resuelve
 * quien la llama —el catálogo vive en un chunk `lazy()`— y así esto se puede
 * testear sin cargar 209 KB de JSON.
 */

import type { WidgetPayload } from "../../lib/device";
import { buildLevels, currentStreak, type HeatmapSession } from "../../lib/heatmap";

/**
 * 26 semanas: medio año, que es lo que entra en un widget mediano de iOS sin
 * que los cuadraditos queden por debajo del área táctil mínima.
 */
export const WIDGET_WEEKS = 26;

/** Cuántos ejercicios entran en el widget grande sin recortarse. */
export const WIDGET_EXERCISE_LIMIT = 6;

export function buildWidgetPayload(input: {
  days: readonly HeatmapSession[];
  todayLabel: string | null;
  todayExercises: readonly { name: string; detail: string }[];
  now?: Date;
}): WidgetPayload {
  const now = input.now ?? new Date();
  return {
    levels: buildLevels(input.days, { weeks: WIDGET_WEEKS, endDate: now }),
    todayLabel: input.todayLabel,
    todayExercises: input.todayExercises.slice(0, WIDGET_EXERCISE_LIMIT).map(
      // Copia explícita: el payload se serializa a JSON y no tiene por qué
      // arrastrar lo que sea que traigan los objetos de quien llama.
      ({ name, detail }) => ({ name, detail }),
    ),
    streak: currentStreak(input.days, now),
  };
}
