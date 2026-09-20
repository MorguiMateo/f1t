import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";

// Miércoles, igual que en heatmap.test.ts.
const WEDNESDAY = new Date(2026, 8, 2);

function render(markup: string) {
  return {
    /** Una celda por día: es lo único que la grilla puede tener de más o de menos. */
    cells: markup.match(/rounded-\[2px\]/g)?.length ?? 0,
    markup,
  };
}

describe("<Heatmap>", () => {
  it("dibuja weeks × 7 celdas, más las 5 de la leyenda", () => {
    const { cells } = render(
      renderToStaticMarkup(
        <Heatmap sessions={[]} weeks={4} endDate={WEDNESDAY} />,
      ),
    );
    expect(cells).toBe(4 * 7 + 5);
  });

  it("codifica la intensidad con opacidad y no con otro color", () => {
    // PLAN.md §5.4: en iOS 26 los modos Clear y Tint aplanan el color del
    // widget a monocromo, así que una escala de tonos se vería uniforme.
    const markup = renderToStaticMarkup(
      <Heatmap
        sessions={[{ performed_on: "2026-09-01", set_count: 30 }]}
        weeks={4}
        endDate={WEDNESDAY}
      />,
    );
    expect(markup).toContain("opacity:1");
    expect(markup).toContain("bg-accent");
    // Un solo color de acento para todos los niveles.
    expect(markup).not.toMatch(/bg-(ok|warn|ink)\b/);
  });

  it("cuenta los días entrenados en la etiqueta accesible", () => {
    const markup = renderToStaticMarkup(
      <Heatmap
        sessions={[
          { performed_on: "2026-09-01", set_count: 12 },
          { performed_on: "2026-08-31", set_count: 4 },
        ]}
        weeks={4}
        endDate={WEDNESDAY}
      />,
    );
    expect(markup).toContain("2 días entrenados");
  });

  it("los días que todavía no ocurrieron no dicen &quot;sin entrenar&quot;", () => {
    // El miércoles quedan jueves a domingo en la última columna: existen en
    // la grilla para que la semana esté completa, pero no son días sin
    // entrenar, son días que no pasaron.
    const markup = renderToStaticMarkup(
      <Heatmap sessions={[]} weeks={1} endDate={WEDNESDAY} />,
    );
    expect(markup.match(/sin entrenar/g)).toHaveLength(3);
  });
});
