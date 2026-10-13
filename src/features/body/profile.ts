/** Measurement validation preserves the user's value; it never invents a replacement. */

import { fromDateKey, toDateKey } from "../../lib/heatmap";

export type Goal = "lose" | "gain" | "maintain";
export type Sex = "male" | "female";

/** Ordered as a scale: down, steady, up. */
export const GOALS: { value: Goal; label: string; hint: string }[] = [
  { value: "lose", label: "Bajar", hint: "Bajar de peso" },
  { value: "maintain", label: "Mantener", hint: "Mantener el peso" },
  { value: "gain", label: "Subir", hint: "Subir de peso" },
];

/**
 * Optional profile information; the rest of the profile works without it.
 */
export const SEXES: { value: Sex; label: string }[] = [
  { value: "female", label: "Mujer" },
  { value: "male", label: "Hombre" },
];

export const GOAL_LABELS: Record<Goal, string> = Object.fromEntries(
  GOALS.map((goal) => [goal.value, goal.label]),
) as Record<Goal, string>;

/** `body_profile_height_check`. */
export const HEIGHT_RANGE = { min: 80, max: 260, decimals: 0 } as const;

/** `body_profile_target_weight_check`, the same range as `weight_entries`. */
export const WEIGHT_RANGE = { min: 20, max: 400, decimals: 1 } as const;

/** `body_profile_birth_date_check`. */
export const MIN_BIRTH_DATE = "1900-01-01";

export function isGoal(value: string | null | undefined): value is Goal {
  return value === "lose" || value === "gain" || value === "maintain";
}

export function isSex(value: string | null | undefined): value is Sex {
  return value === "male" || value === "female";
}

/**
 * The fallback should never fire (`goal` is `not null`), but a cast would
 * hide a fourth goal added to the check constraint and not here.
 */
export function toGoal(value: string | null | undefined): Goal {
  return isGoal(value) ? value : "maintain";
}

export function toSex(value: string | null | undefined): Sex | null {
  return isSex(value) ? value : null;
}

type Range = { min: number; max: number; decimals: number };

/**
 * `null` is an emptied field, a value the schema allows; `undefined` is text
 * that isn't a number, so the caller keeps what was stored.
 */
export function parseMeasure(
  raw: string,
  range: Range,
): number | null | undefined {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;

  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return undefined;
  if ((trimmed.split(".")[1]?.length ?? 0) > range.decimals) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) return undefined;
  return parsed;
}

/**
 * Same outcomes as `parseMeasure`. A future date is rejected, not clamped:
 * it's a typo, and today is no better guess at a birthday.
 */
export function parseBirthDate(
  raw: string,
  now: Date = new Date(),
): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;

  // `fromDateKey` parses to local midnight; `new Date(str)` would read the
  // string as UTC and shift the day for anyone west of Greenwich.
  const date = fromDateKey(trimmed);
  if (Number.isNaN(date.getTime()) || toDateKey(date) !== trimmed) return undefined;
  if (trimmed < MIN_BIRTH_DATE) return undefined;
  if (trimmed > toDateKey(now)) return undefined;

  return trimmed;
}

/**
 * Counted in calendar terms: dividing milliseconds lands a day early roughly
 * one birthday in four because of leap years.
 */
export function ageOn(
  birthDate: string | null,
  now: Date = new Date(),
): number | null {
  if (!birthDate) return null;

  const born = fromDateKey(birthDate);
  if (Number.isNaN(born.getTime())) return null;

  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}
