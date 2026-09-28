/**
 * BMI, BMR, TDEE and the daily calorie target, with no React and no network.
 *
 * Same role as `weight.ts` and `weight-trend.ts`: a formula copied wrong
 * doesn't throw, it returns a plausible wrong number, so every constant here
 * is pinned by a hand-computed case in `energy.test.ts`.
 *
 * The activity factor is derived from the sessions actually logged, not
 * asked (PLAN.md, Phase 5.4): no migration, one question fewer, and it tracks
 * habits as they change instead of the optimistic answer given once.
 */

import { toDateKey } from "../../lib/heatmap";
import type { BodyProfile } from "./api";
import { ageOn, toGoal, toSex, type Goal, type Sex } from "./profile";
import { round1 } from "./weight";

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

export const BMI_CATEGORY_LABELS: Record<BmiCategory, string> = {
  underweight: "Bajo peso",
  normal: "Normal",
  overweight: "Sobrepeso",
  obese: "Obesidad",
};

/** kg/m², one decimal. */
export function bmi(weightKg: number, heightCm: number): number {
  const meters = heightCm / 100;
  return round1(weightKg / (meters * meters));
}

/**
 * WHO cutoffs. Fed the rounded value so the label never disagrees with the
 * number shown next to it (24.96 displays as 25,0 and reads "Sobrepeso").
 */
export function bmiCategory(value: number): BmiCategory {
  if (value < 18.5) return "underweight";
  if (value < 25) return "normal";
  if (value < 30) return "overweight";
  return "obese";
}

/** Mifflin-St Jeor, kcal/day at rest. Unrounded; callers round for display. */
export function bmr(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return input.sex === "male" ? base + 5 : base - 161;
}

/** Four whole weeks: long enough to smooth one off week, short enough to follow a change of habit. */
export const ACTIVITY_WINDOW_DAYS = 28;

const ACTIVITY_WINDOW_WEEKS = ACTIVITY_WINDOW_DAYS / 7;

/** The standard multipliers, indexed by the lowest days per week they cover. */
const ACTIVITY_LEVELS: { minDays: number; factor: number; label: string }[] = [
  { minDays: 7, factor: 1.9, label: "muy alta" },
  { minDays: 5, factor: 1.725, label: "alta" },
  { minDays: 3, factor: 1.55, label: "moderada" },
  { minDays: 1, factor: 1.375, label: "ligera" },
  { minDays: 0, factor: 1.2, label: "sedentaria" }, 
];

export type ActivityLevel = {
  factor: number;
  label: string;
  /** Average over the window, one decimal, for display. */
  daysPerWeek: number;
  /** Sessions counted inside the window. */
  sessions: number;
};

/**
 * Counts the sessions in the `ACTIVITY_WINDOW_DAYS` ending today, inclusive,
 * and maps the weekly average rounded to whole days onto the standard
 * factors. At most one session per day, so the count needs no dedup.
 */
export function activityLevel(
  sessionDays: readonly { performed_on: string }[],
  today: Date = new Date(),
): ActivityLevel {
  const end = toDateKey(today);
  const start = toDateKey(
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - (ACTIVITY_WINDOW_DAYS - 1),
    ),
  );

  const sessions = sessionDays.filter(
    (day) => day.performed_on >= start && day.performed_on <= end,
  ).length;
  const average = sessions / ACTIVITY_WINDOW_WEEKS;
  const wholeDays = Math.round(average);
  const level =
    ACTIVITY_LEVELS.find((candidate) => wholeDays >= candidate.minDays) ??
    ACTIVITY_LEVELS[ACTIVITY_LEVELS.length - 1];

  return {
    factor: level.factor,
    label: level.label,
    daysPerWeek: round1(average),
    sessions,
  };
}

/** −500 is roughly half a kilo a week; +300 is a lean surplus. */
export const GOAL_ADJUSTMENT: Record<Goal, number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
};

const KCAL_STEP = 50;

export type CalorieTarget = {
  kcal: number;
  adjustment: number;
  /** The deficit would have gone below BMR, so the target was raised to it. */
  clamped: boolean;
};

/**
 * Never below BMR: eating under the resting burn is not a plan a formula
 * should hand out. Rounded to 50 because the precision beyond that is
 * fiction, and when rounding would dip under BMR it rounds up instead.
 */
export function calorieTarget(
  tdee: number,
  restingKcal: number,
  goal: Goal,
): CalorieTarget {
  const adjustment = GOAL_ADJUSTMENT[goal];
  const raw = tdee + adjustment;
  const clamped = raw < restingKcal;

  let kcal = Math.round(Math.max(raw, restingKcal) / KCAL_STEP) * KCAL_STEP;
  if (kcal < restingKcal) kcal = Math.ceil(restingKcal / KCAL_STEP) * KCAL_STEP;

  return { kcal, adjustment, clamped };
}

export type MissingField = "height" | "weight" | "sex" | "birthDate";

export const MISSING_LABELS: Record<MissingField, string> = {
  height: "tu altura",
  weight: "un peso",
  sex: "tu sexo",
  birthDate: "tu fecha de nacimiento",
};

export type EnergyReport =
  | {
      status: "missing";
      missing: MissingField[];
      /** Present once height and weight are: BMI needs neither sex nor age. */
      bmi: { value: number; category: BmiCategory } | null;
    }
  | {
      status: "ready";
      bmi: { value: number; category: BmiCategory };
      bmr: number;
      activity: ActivityLevel;
      tdee: number;
      target: CalorieTarget;
      goal: Goal;
    };

function bmiReading(weightKg: number, heightCm: number) {
  const value = bmi(weightKg, heightCm);
  return { value, category: bmiCategory(value) };
}

/** The card's only entry point. `bmr` and `tdee` come back rounded to whole kcal. */
export function energyReport(input: {
  profile: Pick<BodyProfile, "height_cm" | "sex" | "birth_date" | "goal"> | null;
  latestWeightKg: number | null;
  sessionDays: readonly { performed_on: string }[];
  now?: Date;
}): EnergyReport {
  const now = input.now ?? new Date();
  const heightCm = input.profile?.height_cm ?? null;
  const weightKg = input.latestWeightKg;
  const sex = toSex(input.profile?.sex);
  const age = ageOn(input.profile?.birth_date ?? null, now);

  const missing: MissingField[] = [];
  if (heightCm === null) missing.push("height");
  if (weightKg === null) missing.push("weight");
  if (sex === null) missing.push("sex");
  if (age === null) missing.push("birthDate");

  if (heightCm === null || weightKg === null || sex === null || age === null) {
    return {
      status: "missing",
      missing,
      bmi:
        heightCm !== null && weightKg !== null
          ? bmiReading(weightKg, heightCm)
          : null,
    };
  }

  const resting = bmr({ weightKg, heightCm, age, sex });
  const activity = activityLevel(input.sessionDays, now);
  const tdee = resting * activity.factor;
  const goal = toGoal(input.profile?.goal);

  return {
    status: "ready",
    bmi: bmiReading(weightKg, heightCm),
    bmr: Math.round(resting),
    activity,
    tdee: Math.round(tdee),
    target: calorieTarget(tdee, resting, goal),
    goal,
  };
}
