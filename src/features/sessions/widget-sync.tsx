import { useEffect, useState } from "react";
import { device } from "../../lib/device";
import { toDateKey } from "../../lib/heatmap";
import { useUser } from "../auth/session";
import { useActiveRoutine } from "../routines/queries";
import { targetLabel } from "../routines/target";
import { useSessionDays } from "./queries";
import { buildWidgetPayload, WIDGET_EXERCISE_LIMIT } from "./widget";

/** Mounted by AppLayout, not Today: routine and set mutations invalidate these queries. */
export function WidgetSync() {
  const userId = useUser()?.id;
  const { data: days } = useSessionDays();
  const { data: routine } = useActiveRoutine();
  const [date, setDate] = useState(() => new Date());

  useEffect(() => {
    // Repair after local midnight or a suspended timer when returning to F1t.
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      const now = new Date();
      setDate((previous) => toDateKey(previous) === toDateKey(now) ? previous : now);
      clearTimeout(timer);
      timer = setTimeout(refresh, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000);
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    // `null` is a valid no-routine response; undefined means still loading.
    if (!days || routine === undefined || !userId) return;

    const readyDays = days;
    const readyUserId = userId;
    let cancelled = false;
    async function publish() {
      // A rest-only routine needs no 200 KB catalog fetch. Keep that asset out
      // of the initial bundle and load it only to resolve real exercise names.
      const getExercise = routine?.days.some((day) => day.exercises.length)
        ? (await import("../exercises/catalog")).getExercise
        : null;
      if (cancelled) return;
      const routineWeek = Array.from({ length: 7 }, (_, weekday) => {
        const day = routine?.days.find((item) => item.weekday === weekday);
        return {
          weekday,
          label: day?.label ?? null,
          exercises: (day?.exercises ?? []).slice(0, WIDGET_EXERCISE_LIMIT).map((item) => ({
            name: getExercise?.(item.exercise_id)?.name ?? item.exercise_id,
            detail: targetLabel(item.target_sets, item.target_reps) ?? "",
          })),
        };
      });
      const today = routineWeek[date.getDay()];
      await device.syncWidget(buildWidgetPayload({
        days: readyDays,
        todayLabel: today.label,
        todayExercises: today.exercises,
        routineWeek,
        now: date,
      }), readyUserId);
    }
    void publish().catch((error: unknown) => {
      console.error("Could not prepare shared widget data", error);
    });
    return () => { cancelled = true; };
  }, [days, routine, userId, date]);

  return null;
}
