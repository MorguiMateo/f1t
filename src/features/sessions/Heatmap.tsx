import { useMemo } from "react";
import {
  buildHeatmap,
  fromDateKey,
  HEATMAP_MAX_LEVEL,
  trainedDays,
  type HeatmapSession,
} from "../../lib/heatmap";

/**
 * The activity calendar. The first real consumer of the Phase 0 contract: it
 * draws exactly the array the SwiftUI `Heatmap` will later render.
 *
 * **Intensity is encoded with opacity, not hue** (PLAN.md §5.4). This is not
 * an aesthetic preference: on iOS 26 the Clear and Tint modes flatten widget
 * colour to monochrome, so a scale of hues collapses into one uniform block.
 * An opacity scale survives both modes, and as a bonus works identically in
 * light and dark themes because the accent already follows the theme.
 */

/** One value per level 1–4. Level 0 uses no accent: it is the empty-day background. */
const OPACITY = [0, 0.26, 0.48, 0.72, 1];

const DAY_FORMATTER = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const MONTH_FORMATTER = new Intl.DateTimeFormat("es", { month: "short" });

/** Only three of the seven: all seven and the text won't fit beside the grid. */
const ROW_LABELS = ["Lun", "", "Mié", "", "Vie", "", ""];

function cellTitle(date: string, sets: number): string {
  const when = DAY_FORMATTER.format(fromDateKey(date));
  if (!sets) return `${when}: sin entrenar`;
  return `${when}: ${sets} ${sets === 1 ? "serie" : "series"}`;
}

export function Heatmap({
  sessions,
  weeks = 26,
  endDate,
}: {
  sessions: readonly HeatmapSession[];
  weeks?: number;
  endDate?: Date;
}) {
  const cells = useMemo(
    () => buildHeatmap(sessions, { weeks, endDate }),
    [sessions, weeks, endDate],
  );

  // The month label sits above the first column that falls in that month.
  const months = useMemo(() => {
    const labels: { column: number; label: string }[] = [];
    let last = "";
    for (let week = 0; week < weeks; week++) {
      const date = fromDateKey(cells[week * 7].date);
      const label = MONTH_FORMATTER.format(date).replace(".", "");
      if (label !== last) {
        labels.push({ column: week + 1, label });
        last = label;
      }
    }
    return labels;
  }, [cells, weeks]);

  const total = trainedDays(cells);
  const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };

  return (
    <div>
      <div className="flex gap-1.5">
        {/* The weekday column lines up with the grid because they share row
            heights: seven rows of 1fr on both sides. */}
        <div className="flex shrink-0 flex-col justify-between pt-[1.125rem] text-[0.5rem] leading-none text-muted">
          {ROW_LABELS.map((label, index) => (
            <span key={index} className="flex h-[1em] items-center">
              {label}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="mb-1 grid text-[0.5rem] leading-none text-muted"
            style={columns}
            aria-hidden="true"
          >
            {months.map((month) => (
              <span key={month.column} style={{ gridColumn: month.column }}>
                {month.label}
              </span>
            ))}
          </div>

          {/* A single accessible element: 182 cells announced one by one are
              not information, they are noise. Each day's detail stays in the
              `title`, which is what shows on a long press. */}
          <div
            className="grid grid-flow-col gap-[2px]"
            style={{ ...columns, gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
            role="img"
            aria-label={`Calendario de actividad: ${total} ${
              total === 1 ? "día entrenado" : "días entrenados"
            } en las últimas ${weeks} semanas.`}
          >
            {cells.map((cell) => (
              <div
                key={cell.date}
                title={cell.isFuture ? undefined : cellTitle(cell.date, cell.sets)}
                className={[
                  "aspect-square rounded-[2px]",
                  cell.isFuture
                    ? "bg-surface-2/40"
                    : cell.level === 0
                      ? "bg-surface-2"
                      : "bg-accent",
                ].join(" ")}
                style={
                  cell.level > 0 ? { opacity: OPACITY[cell.level] } : undefined
                }
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[0.625rem] text-muted">
        <span>Menos</span>
        {Array.from({ length: HEATMAP_MAX_LEVEL + 1 }, (_, level) => (
          <span
            key={level}
            className={[
              "size-2.5 rounded-[2px]",
              level === 0 ? "bg-surface-2" : "bg-accent",
            ].join(" ")}
            style={level > 0 ? { opacity: OPACITY[level] } : undefined}
          />
        ))}
        <span>Más</span>
      </div>
    </div>
  );
}
