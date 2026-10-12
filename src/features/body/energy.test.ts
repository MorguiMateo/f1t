import { describe, expect, it } from "vitest";
import { toDateKey } from "../../lib/heatmap";
import {
  activityLevel,
  bmi,
  bmiCategory,
  bmr,
  calorieTarget,
  energyReport,
  latestWeightOnDate,
} from "./energy";

const TODAY = new Date(2026, 8, 28);

describe('historical energy inputs', () => {
  it('never uses a weight measured after the diary date', () => {
    const weights = [
      { measured_on: '2026-09-29', weight_kg: 80 },
      { measured_on: '2026-09-20', weight_kg: 79 },
    ];
    expect(latestWeightOnDate(weights, '2026-09-25')).toBe(79);
    expect(latestWeightOnDate(weights, '2026-09-19')).toBeNull();
    expect(latestWeightOnDate(weights, '2026-09-29')).toBe(80);
  });
});

describe('food snapshot schema bound', () => {
  it('allows the maximum target produced by permitted profile inputs', () => {
    const now = new Date(2026, 8, 29);
    const days = Array.from({ length: 28 }, (_, index) => ({
      performed_on: toDateKey(new Date(2026, 8, 29 - index)),
    }));
    const report = energyReport({
      profile: { height_cm: 260, birth_date: '2026-09-29', sex: 'male', goal: 'gain' },
      latestWeightKg: 400,
      sessionDays: days,
      now,
    });
    expect(report.status).toBe('ready');
    if (report.status === 'ready') {
      expect(report.bmr).toBe(5630);
      expect(report.tdee).toBe(10697);
      expect(report.target.kcal).toBe(11000);
    }
  });
});

/** `count` consecutive session days ending today. */
function sessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    performed_on: toDateKey(new Date(2026, 8, 28 - index)),
  }));
}

describe("bmi", () => {
  it("divides by height in metres squared, one decimal", () => {
    // 80 / 1.8² = 24.69…
    expect(bmi(80, 180)).toBe(24.7);
  });
});

describe("bmiCategory", () => {
  it("puts each WHO cutoff in the upper band", () => {
    expect(bmiCategory(18.4)).toBe("underweight");
    expect(bmiCategory(18.5)).toBe("normal");
    expect(bmiCategory(24.9)).toBe("normal");
    expect(bmiCategory(25)).toBe("overweight");
    expect(bmiCategory(29.9)).toBe("overweight");
    expect(bmiCategory(30)).toBe("obese");
  });
});

describe("bmr", () => {
  it("matches Mifflin-St Jeor for a man", () => {
    // 10·80 + 6.25·180 − 5·30 + 5
    expect(bmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" })).toBe(
      1780,
    );
  });

  it("matches Mifflin-St Jeor for a woman", () => {
    // 10·60 + 6.25·165 − 5·30 − 161
    expect(bmr({ weightKg: 60, heightCm: 165, age: 30, sex: "female" })).toBe(
      1320.25,
    );
  });
});

describe("activityLevel", () => {
  it("is sedentary with no sessions", () => {
    expect(activityLevel([], TODAY)).toMatchObject({
      factor: 1.2,
      sessions: 0,
      daysPerWeek: 0,
    });
  });

  it("rounds the weekly average to whole days before picking a factor", () => {
    expect(activityLevel(sessions(1), TODAY).factor).toBe(1.2); // 0.25
    expect(activityLevel(sessions(2), TODAY).factor).toBe(1.375); // 0.5
    expect(activityLevel(sessions(9), TODAY).factor).toBe(1.375); // 2.25
    expect(activityLevel(sessions(10), TODAY).factor).toBe(1.55); // 2.5
    expect(activityLevel(sessions(17), TODAY).factor).toBe(1.55); // 4.25
    expect(activityLevel(sessions(18), TODAY).factor).toBe(1.725); // 4.5
    expect(activityLevel(sessions(25), TODAY).factor).toBe(1.725); // 6.25
    expect(activityLevel(sessions(26), TODAY).factor).toBe(1.9); // 6.5
    expect(activityLevel(sessions(28), TODAY).factor).toBe(1.9); // 7
  });

  it("reports the unrounded average for display", () => {
    expect(activityLevel(sessions(10), TODAY)).toMatchObject({
      daysPerWeek: 2.5,
      sessions: 10,
      label: "moderada",
    });
  });

  it("counts only the 28 days ending today", () => {
    const level = activityLevel(
      [
        { performed_on: "2026-08-31" }, // one day before the window
        { performed_on: "2026-09-01" }, // first day of the window
        { performed_on: "2026-09-28" }, // today
        { performed_on: "2026-09-29" }, // tomorrow
      ],
      TODAY,
    );
    expect(level.sessions).toBe(2);
  });
});

describe("calorieTarget", () => {
  // 1780 · 1.55
  const tdee = 2759;

  it("subtracts 500 to lose", () => {
    expect(calorieTarget(tdee, 1780, "lose")).toEqual({
      kcal: 2250,
      adjustment: -500,
      clamped: false,
    });
  });

  it("adds 300 to gain", () => {
    expect(calorieTarget(tdee, 1780, "gain").kcal).toBe(3050);
  });

  it("keeps the TDEE to maintain, rounded to 50", () => {
    expect(calorieTarget(tdee, 1780, "maintain").kcal).toBe(2750);
  });

  it("never goes below BMR, rounding up when needed", () => {
    // 1320.25 · 1.2 − 500 = 1084.3, under the resting burn.
    const target = calorieTarget(1320.25 * 1.2, 1320.25, "lose");
    expect(target.clamped).toBe(true);
    // 1320.25 would round down to 1300, which is still under BMR.
    expect(target.kcal).toBe(1350);
  });
});

describe("energyReport", () => {
  const complete = {
    height_cm: 180,
    sex: "male",
    birth_date: "1996-09-28",
    goal: "lose",
  };

  it("lists everything when nothing is filled in", () => {
    expect(
      energyReport({
        profile: null,
        latestWeightKg: null,
        sessionDays: [],
        now: TODAY,
      }),
    ).toEqual({
      status: "missing",
      missing: ["height", "weight", "sex", "birthDate"],
      bmi: null,
    });
  });

  it("shows BMI as soon as height and weight exist", () => {
    expect(
      energyReport({
        profile: { ...complete, sex: null, birth_date: null },
        latestWeightKg: 80,
        sessionDays: [],
        now: TODAY,
      }),
    ).toEqual({
      status: "missing",
      missing: ["sex", "birthDate"],
      bmi: { value: 24.7, category: "normal" },
    });
  });

  it("asks for a weight when only the profile is complete", () => {
    const report = energyReport({
      profile: complete,
      latestWeightKg: null,
      sessionDays: [],
      now: TODAY,
    });
    expect(report).toEqual({ status: "missing", missing: ["weight"], bmi: null });
  });

  it("computes the whole chain once everything is there", () => {
    const report = energyReport({
      profile: complete,
      latestWeightKg: 80,
      sessionDays: sessions(12),
      now: TODAY,
    });
    expect(report).toMatchObject({
      status: "ready",
      bmi: { value: 24.7, category: "normal" },
      bmr: 1780,
      activity: { factor: 1.55, daysPerWeek: 3 },
      tdee: 2759,
      target: { kcal: 2250, adjustment: -500 },
      goal: "lose",
    });
  });

  it("uses the age on the given day, birthday included", () => {
    const dayBefore = energyReport({
      profile: { ...complete, birth_date: "1996-09-29" },
      latestWeightKg: 80,
      sessionDays: [],
      now: TODAY,
    });
    // Still 29: five kcal more than at 30.
    expect(dayBefore).toMatchObject({ status: "ready", bmr: 1785 });
  });
});
