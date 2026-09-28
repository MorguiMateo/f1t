import { useEffect } from "react";
import { device } from "../../lib/device";
import { getExercise } from "../exercises/catalog";
import type { RoutineDay } from "../routines/api";
import { targetLabel } from "../routines/target";
import { useSessionDays } from "./queries";
import { buildWidgetPayload, WIDGET_EXERCISE_LIMIT } from "./widget";

/**
 * Publishes widget state. A component, not a loose effect, because it needs
 * the catalog; mounted with `lazy()` so the catalog doesn't enter the initial chunk.
 */
export function WidgetSync({ day }: { day: RoutineDay | null }) {
  const { data: days } = useSessionDays();

  useEffect(() => {
    if (!days) return;

    void device.syncWidget(
      buildWidgetPayload({
        days,
        todayLabel: day?.label ?? null,
        todayExercises: (day?.exercises ?? [])
          .slice(0, WIDGET_EXERCISE_LIMIT)
          .map((item) => ({
            name: getExercise(item.exercise_id)?.name ?? item.exercise_id,
            detail: targetLabel(item.target_sets, item.target_reps) ?? "",
          })),
      }),
    );
    // `day` comes out of the React Query cache, so its identity only changes
    // when the data changed. Writing the payload once too often is writing a
    // localStorage key; writing it once too rarely is a stale widget.
  }, [days, day]);

  return null;
}
