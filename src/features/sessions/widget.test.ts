import { describe, expect, it } from "vitest";
import { buildWidgetPayload, WIDGET_EXERCISE_LIMIT, WIDGET_WEEKS } from "./widget";

const NOW = new Date(2026, 8, 20); // Sunday 20 September 2026

describe("buildWidgetPayload", () => {
  it("respeta el contrato de buildLevels: enteros 0–4, largo weeks × 7", () => {
    const payload = buildWidgetPayload({
      days: [{ performed_on: "2026-09-19", set_count: 30 }],
      todayLabel: null,
      todayExercises: [],
      now: NOW,
    });

    expect(payload.levels).toHaveLength(WIDGET_WEEKS * 7);
    expect(payload.levels.every((l) => Number.isInteger(l) && l >= 0 && l <= 4)).toBe(
      true,
    );
    expect(payload.levels.at(-2)).toBe(4);
  });

  it("un día de descanso viaja como todayLabel null, no como payload vacío", () => {
    const payload = buildWidgetPayload({
      days: [],
      todayLabel: null,
      todayExercises: [],
      now: NOW,
    });
    expect(payload.todayLabel).toBeNull();
    expect(payload.todayExercises).toEqual([]);
    expect(payload.streak).toBe(0);
  });

  it("la racha sale del mismo histórico que el heatmap", () => {
    const payload = buildWidgetPayload({
      days: [
        { performed_on: "2026-09-18", set_count: 10 },
        { performed_on: "2026-09-19", set_count: 10 },
        { performed_on: "2026-09-20", set_count: 10 },
      ],
      todayLabel: "Empuje",
      todayExercises: [],
      now: NOW,
    });
    expect(payload.streak).toBe(3);
  });

  it("recorta la lista a lo que entra en el widget grande", () => {
    const many = Array.from({ length: WIDGET_EXERCISE_LIMIT + 3 }, (_, i) => ({
      name: `Ejercicio ${i}`,
      detail: "3 × 10",
    }));
    const payload = buildWidgetPayload({
      days: [],
      todayLabel: "Pierna",
      todayExercises: many,
      now: NOW,
    });
    expect(payload.todayExercises).toHaveLength(WIDGET_EXERCISE_LIMIT);
    expect(payload.todayExercises[0]).toEqual({
      name: "Ejercicio 0",
      detail: "3 × 10",
    });
  });

  it("el payload es serializable tal cual: es lo que va al App Group", () => {
    const payload = buildWidgetPayload({
      days: [{ performed_on: "2026-09-20", set_count: 12 }],
      todayLabel: "Empuje",
      todayExercises: [{ name: "Press de banca", detail: "4 × 8" }],
      now: NOW,
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
