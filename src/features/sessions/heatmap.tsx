import { useMemo } from "react";
import {
  buildHeatmap,
  fromDateKey,
  HEATMAP_MAX_LEVEL,
  trainedDays,
  type HeatmapSession,
} from "../../lib/heatmap";

/**
 * Intensity is encoded with opacity, not hue: iOS 26 Clear and Tint widget
 * modes flatten colour to monochrome, which would collapse a hue scale.
 */

const OPACITY = [0, 0.26, 0.48, 0.72, 1];

const DAY_FORMATTER = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const MONTH_FORMATTER = new Intl.DateTimeFormat("es", { month: "short" });

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

          {/* One accessible element; per-day detail stays in `title`. */}
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
