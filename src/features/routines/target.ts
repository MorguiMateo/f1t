/**
 * Cómo se escribe el objetivo de un ejercicio.
 *
 * Vive en su propio módulo y no al lado del componente que lo dibuja porque
 * lo usan dos consumidores: la línea de la pantalla y el `WidgetPayload` que
 * lee el widget de iOS. Dos formateos del mismo dato se separan en cuanto
 * uno de los dos cambie.
 */

/** "3 × 8-12", o lo que se sepa. Guiones no: un objetivo vacío es válido. */
export function targetLabel(
  sets: number | null,
  reps: string | null,
): string | null {
  if (sets && reps) return `${sets} × ${reps}`;
  if (sets) return `${sets} ${sets === 1 ? "serie" : "series"}`;
  if (reps) return `${reps} reps`;
  return null;
}
