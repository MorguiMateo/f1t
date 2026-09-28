// Shared with the iOS widget payload so both render the target identically.
// An empty target is valid, so it returns null rather than a placeholder dash.
export function targetLabel(
  sets: number | null,
  reps: string | null,
): string | null {
  if (sets && reps) return `${sets} × ${reps}`;
  if (sets) return `${sets} ${sets === 1 ? "serie" : "series"}`;
  if (reps) return `${reps} reps`;
  return null;
}
