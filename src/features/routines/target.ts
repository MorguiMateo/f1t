/**
 * How an exercise's target is written out.
 *
 * It lives in its own module and not next to the component that draws it
 * because two consumers use it: the on-screen line and the `WidgetPayload`
 * the iOS widget reads. Two formatters for the same value drift apart the
 * moment one of them changes.
 */

/** "3 × 8-12", or whatever is known. No em dashes: an empty target is valid. */
export function targetLabel(
  sets: number | null,
  reps: string | null,
): string | null {
  if (sets && reps) return `${sets} × ${reps}`;
  if (sets) return `${sets} ${sets === 1 ? "serie" : "series"}`;
  if (reps) return `${reps} reps`;
  return null;
}
