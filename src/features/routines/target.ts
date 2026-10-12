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

const MAX_TARGET_WEIGHT = 9999.99;

// Accepts "60", "82,5" and ".5". Anything else is invalid, not empty, so a typo
// never wipes a saved weight.
const WEIGHT_PATTERN = /^(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * `null` is a cleared field (no weight chosen) and `undefined` is invalid
 * text. 0 is a real weight (bodyweight, empty bar) and stays distinct from null.
 */
export function parseTargetWeight(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!WEIGHT_PATTERN.test(text)) return undefined;
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value)) return undefined;
  return Math.min(MAX_TARGET_WEIGHT, Math.round(value * 100) / 100);
}

export function weightLabel(weightKg: number | null | undefined): string | null {
  if (weightKg === null || weightKg === undefined) return null;
  return `${weightKg.toString().replace(".", ",")} kg`;
}
