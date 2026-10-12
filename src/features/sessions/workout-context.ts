import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { assertAuthQueryClientActive } from "../auth/auth-query-client";
import type { RoutineDay } from "../routines/api";
import type { SessionDetail } from "./api";
import type { planWorkout } from "./plan";
import { supabase } from "../../lib/supabase";
import { unwrap } from "../../lib/postgrest";

export type WorkoutDay = {
  id: string | null;
  routine_id: string | null;
  label: string;
  exercises: Parameters<typeof planWorkout>[0]["items"][number][];
};

/** Called only for a day referenced by the authenticated date's session. */
export async function fetchOwnedLoggedDay(owner: string, dayId: string, client: QueryClient): Promise<RoutineDay | null> {
  assertAuthQueryClientActive(client);
  const row = unwrap(await supabase.from("routine_days").select("*, routine_exercises(*)")
    .eq("id", dayId).eq("user_id", owner).maybeSingle());
  assertAuthQueryClientActive(client);
  if (!row || row.user_id !== owner || row.id !== dayId) return null;
  const { routine_exercises, ...day } = row;
  return { ...day, exercises: routine_exercises.filter(item => item.user_id === owner && item.routine_day_id === dayId).sort((a, b) => a.position - b.position) };
}

export function useOwnedLoggedDay(owner: string | null, dayId: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ["sessions", "logged-day", owner, dayId],
    enabled: Boolean(owner && dayId),
    queryFn: () => fetchOwnedLoggedDay(owner!, dayId!, client),
  });
}

/** Deleted plans are not replaced by today's unrelated routine. */
export function recordedWorkoutDay(session: SessionDetail, owner: string): WorkoutDay {
  const sets = session.sets.filter(set => set.user_id === owner && set.session_id === session.id);
  const exercises = [...new Set(sets.map(set => set.exercise_id))].map(id => ({
    id: `recorded:${id}`, exercise_id: id,
    target_sets: Math.max(...sets.filter(set => set.exercise_id === id).map(set => set.set_index + 1)),
    target_reps: null, target_weight_kg: null,
  }));
  return { id: session.routine_day_id, routine_id: null, label: "Entrenamiento registrado", exercises };
}

export function includeRecordedExercises(day: WorkoutDay, session: SessionDetail | null, owner: string): WorkoutDay {
  if (!session) return day;
  const recorded = recordedWorkoutDay(session, owner);
  return { ...day, exercises: [...day.exercises, ...recorded.exercises.filter(item => !day.exercises.some(existing => existing.exercise_id === item.exercise_id))] };
}

type FrozenPlan = { owner: string; date: string; day: WorkoutDay; originalKnown: boolean };
type PlanStorage = Pick<Storage, "getItem" | "setItem">;

/** A local snapshot freezes targets/order, never progress or registered values. */
export function createFrozenWorkoutPlans(owner: string | null, supplied?: PlanStorage | null) {
  let storage = supplied;
  if (storage === undefined) {
    try { storage = typeof window === "undefined" ? null : window.localStorage; } catch { storage = null; }
  }
  const plans = new Map<string, FrozenPlan>();
  const key = (date: string, day: string | null) => `f1t:workout-plan:v1:${encodeURIComponent(owner ?? "")}:${JSON.stringify([date, day])}`;
  let storageError = false;
  return {
    get storageError() { return storageError; },
    get(date: string, dayId: string | null): FrozenPlan | null {
      const id = key(date, dayId);
      if (plans.has(id)) return plans.get(id)!;
      if (!owner || !storage) return null;
      try {
        const value = JSON.parse(storage.getItem(id) ?? "null") as FrozenPlan | null;
        if (!value || value.owner !== owner || value.date !== date || value.day?.id !== dayId ||
            typeof value.day.label !== "string" || (value.day.routine_id !== null && typeof value.day.routine_id !== "string") ||
            typeof value.originalKnown !== "boolean" || !Array.isArray(value.day.exercises) || !value.day.exercises.every(item =>
              typeof item.id === "string" && typeof item.exercise_id === "string" &&
              (item.target_sets === null || Number.isInteger(item.target_sets) && item.target_sets >= 0 && item.target_sets <= 999) &&
              (item.target_reps === null || typeof item.target_reps === "string") &&
              (item.target_weight_kg == null || Number.isFinite(item.target_weight_kg) && item.target_weight_kg >= 0 && item.target_weight_kg <= 9999.99))) return null;
        plans.set(id, value); return value;
      } catch { return null; }
    },
    freeze(date: string, day: WorkoutDay, originalKnown: boolean) {
      if (this.get(date, day.id)) return;
      const copy: FrozenPlan = { owner: owner ?? "", date, originalKnown,
        day: { id: day.id, routine_id: day.routine_id, label: day.label, exercises: day.exercises.map(item => ({
          id: item.id, exercise_id: item.exercise_id, target_sets: item.target_sets,
          target_reps: item.target_reps, target_weight_kg: item.target_weight_kg ?? null,
        })) } };
      plans.set(key(date, day.id), copy);
      if (!owner) return;
      try {
        if (!storage) throw new Error("unavailable");
        storage.setItem(key(date, day.id), JSON.stringify(copy));
      } catch { storageError = true; }
    },
  };
}
