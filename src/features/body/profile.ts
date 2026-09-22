/**
 * The vocabulary of the body profile, with no React and no network.
 *
 * Two jobs live here. One is translating: the database stores `goal` and
 * `sex` as plain `text`, so what comes back is typed `string` and every
 * screen would otherwise cast it on its own. The other is parsing what gets
 * typed into a field, which has to happen before the write and not after the
 * database bounces it: a 400 from PostgREST arrives as a red box, while a
 * clamp arrives as the number correcting itself under your thumb.
 *
 * Every bound below mirrors a constraint in the schema. They are duplicated
 * on purpose and the duplication only goes one way: the database is the one
 * that enforces them, this is the one that avoids the round trip. Same
 * arrangement as `MAX_SETS` in `routine-exercise-item.tsx`.
 */

import { fromDateKey, toDateKey } from "../../lib/heatmap";

export type Goal = "lose" | "gain" | "maintain";
export type Sex = "male" | "female";

/**
 * The goals, in the order they read as a scale: down, steady, up. The hint is
 * what makes the choice mean something before Phase 5.4 turns it into a
 * calorie number.
 */
export const GOALS: { value: Goal; label: string; hint: string }[] = [
  { value: "lose", label: "Bajar", hint: "Déficit calórico" },
  { value: "maintain", label: "Mantener", hint: "Sostener el peso actual" },
  { value: "gain", label: "Subir", hint: "Superávit calórico" },
];

/**
 * Only the two values Mifflin-St Jeor has a coefficient for, which is the
 * only reason the field exists at all. It stays optional: the equation is
 * one of several things the profile feeds, and the rest work without it.
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
 * `goal` is `not null default 'maintain'` in the schema, so this fallback
 * should never fire. It exists because the generated type says `string` and
 * a cast would hide the day someone adds a fourth goal to the check
 * constraint and forgets this file.
 */
export function toGoal(value: string | null | undefined): Goal {
  return isGoal(value) ? value : "maintain";
}

export function toSex(value: string | null | undefined): Sex | null {
  return isSex(value) ? value : null;
}

type Range = { min: number; max: number; decimals: number };

/**
 * Reads a number out of an input.
 *
 * Three outcomes, because a field has three of them: `null` is an emptied
 * field, which is a legitimate value — not knowing your height is a state
 * the schema allows. `undefined` is text that isn't a number, where the only
 * sane move is to keep what was stored. Anything else is the number, rounded
 * to the decimals the column holds and clamped into range, so a slipped key
 * turns into the nearest real value instead of a rejected write.
 */
export function parseMeasure(
  raw: string,
  range: Range,
): number | null | undefined {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;

  const factor = 10 ** range.decimals;
  const rounded = Math.round(parsed * factor) / factor;
  return Math.min(range.max, Math.max(range.min, rounded));
}

/**
 * Reads a `<input type="date">` value. Same three outcomes as above: cleared,
 * unusable, or a `YYYY-MM-DD` the `date` column accepts.
 *
 * The future is rejected here and not clamped to today, because a date in the
 * future is a typo and today is not a better guess at a birthday than the
 * empty field the user can see.
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
  if (Number.isNaN(date.getTime())) return undefined;
  if (trimmed < MIN_BIRTH_DATE) return undefined;
  if (trimmed > toDateKey(now)) return undefined;

  return trimmed;
}

/**
 * Age in completed years, which is what Mifflin-St Jeor takes in Phase 5.4
 * and what the form echoes back so a mistyped year is visible immediately.
 *
 * Counted in calendar terms rather than by dividing milliseconds: leap years
 * make the division land a day early roughly one birthday in four.
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
  // The birthday has not come round yet this year.
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}
