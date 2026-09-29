// Shared by the web and the payload prepared for the future iOS widget.
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
