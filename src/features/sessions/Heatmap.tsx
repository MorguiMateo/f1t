import { useMemo } from "react";
import {
  buildHeatmap,
  fromDateKey,
  HEATMAP_MAX_LEVEL,
  trainedDays,
  type HeatmapSession,
} from "../../lib/heatmap";

/**
 * El calendario de actividad. El primer consumidor real del contrato de la
 * Fase 0: dibuja exactamente el array que más adelante va a renderizar el
 * `Heatmap` de SwiftUI.
 *
 * **La intensidad se codifica con opacidad, no con tono** (PLAN.md §5.4). No
 * es una preferencia estética: en iOS 26 los modos Clear y Tint aplanan el
 * color del widget a monocromo, así que una escala de tonos se vuelve un
 * bloque uniforme. Una escala de opacidad sobrevive a los dos modos, y de
 * paso funciona igual en tema claro y oscuro porque el acento ya cambia con
 * el tema.
 */

/** Un valor por nivel 1–4. El 0 no usa acento: es el fondo del día vacío. */
const OPACITY = [0, 0.26, 0.48, 0.72, 1];

const DAY_FORMATTER = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const MONTH_FORMATTER = new Intl.DateTimeFormat("es", { month: "short" });

/** Solo tres de los siete: con los siete no entra el texto al lado de la grilla. */
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

  // La etiqueta del mes va sobre la primera columna que cae en ese mes.
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
        {/* La columna de días se alinea con la grilla porque comparten alto
            de fila: 7 filas de 1fr en las dos. */}
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

          {/* Un solo elemento accesible: 182 celdas anunciadas una por una no
              son información, son ruido. El detalle de cada día queda en el
              `title`, que es lo que se ve al mantener apretado. */}
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
