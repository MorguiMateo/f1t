import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./heatmap";

// A Wednesday, same as in heatmap.test.ts.
const WEDNESDAY = new Date(2026, 8, 2);

function render(markup: string) {
  return {
    /** One cell per day: the only thing the grid can have too many or too few of. */
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
    // PLAN.md §5.4: on iOS 26 the Clear and Tint modes flatten widget colour
    // to monochrome, so a scale of hues would look uniform.
    const markup = renderToStaticMarkup(
      <Heatmap
        sessions={[{ performed_on: "2026-09-01", set_count: 30 }]}
        weeks={4}
        endDate={WEDNESDAY}
      />,
    );
    expect(markup).toContain("opacity:1");
    expect(markup).toContain("bg-accent");
    // A single accent colour for every level.
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
    // On Wednesday, Thursday through Sunday remain in the last column: they
    // exist in the grid so the week is complete, but they aren't untrained
    // days, they are days that haven't happened.
    const markup = renderToStaticMarkup(
      <Heatmap sessions={[]} weeks={1} endDate={WEDNESDAY} />,
    );
    expect(markup.match(/sin entrenar/g)).toHaveLength(3);
  });
});
