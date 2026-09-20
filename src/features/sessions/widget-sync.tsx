import { useEffect } from "react";
import { device } from "../../lib/device";
import { getExercise } from "../exercises/catalog";
import type { RoutineDay } from "../routines/api";
import { targetLabel } from "../routines/target";
import { useSessionDays } from "./queries";
import { buildWidgetPayload, WIDGET_EXERCISE_LIMIT } from "./widget";

/**
 * Publishes state through `device.syncWidget()`. Draws nothing.
 *
 * On the web the bridge only writes the payload to localStorage — there is no
 * widget to read it — and it still runs from Phase 4. This is what keeps the
 * §5.1 contract honest: `buildLevels()` has a real consumer from day one, so
 * the day the SwiftUI widget arrives nobody has to find out then whether the
 * shape of the array was any good.
 *
 * It is a component and not a loose effect in `today-page` because it needs
 * the catalog for the pretty names, and the catalog cannot enter the initial
 * chunk (PLAN.md, Phase 2). It is mounted with `lazy()` from the index route,
 * with `day = null` on rest days: a rest day is information the widget has to
 * show too.
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
