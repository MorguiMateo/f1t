import { describe, expect, it } from "vitest";
import { exerciseSamples, exerciseMetricValue, type ExerciseHistoryRow } from "./exercise-trend";

describe("exercise progress comparisons", () => {
  const rows: ExerciseHistoryRow[] = [
    { id: "new", performed_on: "2026-10-09", session_sets: [{ exercise_id: "press", reps: 10, weight_kg: 20 }, { exercise_id: "press", reps: null, weight_kg: 25 }, { exercise_id: "other", reps: 100, weight_kg: 100 }] },
    { id: "old", performed_on: "2026-10-01", session_sets: [{ exercise_id: "press", reps: 8, weight_kg: 15 }, { exercise_id: "press", reps: 10, weight_kg: 15 }] },
  ];
  it("keeps each exercise isolated and sorts dates before comparing", () => {
    const samples = exerciseSamples(rows, "press");
    expect(samples.map((sample) => sample.id)).toEqual(["old", "new"]);
    expect(samples[1]).toMatchObject({ load: 25, repetitions: 10, volume: 200, volumeSetCount: 1, setCount: 2 });
  });
  it("does not compare incomplete volume to a complete session", () => {
    const samples = exerciseSamples(rows, "press");
    expect(exerciseMetricValue(samples[0], "volume")).toBe(270);
    expect(exerciseMetricValue(samples[1], "volume")).toBeNull();
  });
  it("retains explicit zero while rejecting invalid metrics", () => {
    const sample = exerciseSamples([{ id: "s", performed_on: "2026-10-10", session_sets: [{ exercise_id: "press", reps: 0, weight_kg: 0 }] }], "press")[0];
    expect(exerciseMetricValue(sample, "volume")).toBe(0);
    expect(exerciseSamples(rows, "missing")).toEqual([]);
  });
});
