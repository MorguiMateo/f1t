export type ExerciseHistoryRow = { id: string; performed_on: string; session_sets: { exercise_id: string; reps: number | null; weight_kg: number | null }[] };
export type ExerciseMetric = "load" | "repetitions" | "volume";
export type ExerciseSample = { id: string; date: string; setCount: number; load: number | null; repetitions: number | null; volume: number | null; volumeSetCount: number };

export function exerciseSamples(rows: readonly ExerciseHistoryRow[], exercise: string): ExerciseSample[] {
  return rows.flatMap((row) => {
    const sets = row.session_sets.filter((set) => set.exercise_id === exercise);
    if (!sets.length) return [];
    const loads = sets.flatMap((set) => set.weight_kg !== null && Number.isFinite(set.weight_kg) && set.weight_kg >= 0 ? [set.weight_kg] : []);
    const reps = sets.flatMap((set) => set.reps !== null && Number.isFinite(set.reps) && set.reps >= 0 ? [set.reps] : []);
    const volumes = sets.flatMap((set) => set.weight_kg !== null && Number.isFinite(set.weight_kg) && set.weight_kg >= 0 && set.reps !== null && Number.isFinite(set.reps) && set.reps >= 0 ? [set.weight_kg * set.reps] : []);
    return [{ id: row.id, date: row.performed_on, setCount: sets.length, load: loads.length ? Math.max(...loads) : null, repetitions: reps.length ? reps.reduce((a, b) => a + b, 0) : null, volume: volumes.length ? volumes.reduce((a, b) => a + b, 0) : null, volumeSetCount: volumes.length }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function exerciseMetricValue(sample: ExerciseSample, metric: ExerciseMetric): number | null {
  return metric === "volume" && sample.volumeSetCount !== sample.setCount ? null : sample[metric];
}
