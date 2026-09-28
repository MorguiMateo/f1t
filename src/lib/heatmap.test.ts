import { describe, expect, it } from "vitest";
import {
  buildHeatmap,
  buildLevels,
  currentStreak,
  fromDateKey,
  heatmapStart,
  toDateKey,
  trainedDays,
} from "./heatmap";

// 2026-09-02, mid-week so week alignment is exercised.
const WEDNESDAY = new Date(2026, 8, 2);

describe("claves de fecha", () => {
  it("formatea en hora local, sin correrse por UTC", () => {
    // toISOString returns the previous day in negative UTC offsets.
    expect(toDateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(toDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("hace ida y vuelta sin perder el día", () => {
    const key = "2026-03-09";
    expect(toDateKey(fromDateKey(key))).toBe(key);
  });
});

describe("buildLevels", () => {
  it("devuelve exactamente weeks * 7 valores", () => {
    expect(buildLevels([], { weeks: 26, endDate: WEDNESDAY })).toHaveLength(182);
    expect(buildLevels([], { weeks: 12, endDate: WEDNESDAY })).toHaveLength(84);
    expect(buildLevels([], { weeks: 1, endDate: WEDNESDAY })).toHaveLength(7);
  });

  it("sin sesiones, todo queda en cero", () => {
    const levels = buildLevels([], { weeks: 4, endDate: WEDNESDAY });
    expect(levels.every((level) => level === 0)).toBe(true);
  });

  it("empieza en lunes y termina en domingo por defecto", () => {
    const cells = buildHeatmap([], { weeks: 4, endDate: WEDNESDAY });
    expect(fromDateKey(cells[0].date).getDay()).toBe(1);
    expect(fromDateKey(cells[cells.length - 1].date).getDay()).toBe(0);
  });

  it("respeta weekStartsOn: 0 para semanas que arrancan en domingo", () => {
    const cells = buildHeatmap([], {
      weeks: 4,
      endDate: WEDNESDAY,
      weekStartsOn: 0,
    });
    expect(fromDateKey(cells[0].date).getDay()).toBe(0);
    expect(fromDateKey(cells[cells.length - 1].date).getDay()).toBe(6);
  });

  it("escala el nivel según el volumen de series", () => {
    const cells = buildHeatmap(
      [
        { performed_on: "2026-08-31", set_count: 4 },
        { performed_on: "2026-09-01", set_count: 14 },
        { performed_on: "2026-09-02", set_count: 22 },
      ],
      { weeks: 2, endDate: WEDNESDAY },
    );

    const byDate = new Map(cells.map((cell) => [cell.date, cell.level]));
    expect(byDate.get("2026-08-31")).toBe(1);
    expect(byDate.get("2026-09-01")).toBe(2);
    expect(byDate.get("2026-09-02")).toBe(3);
  });

  it("una sesión sin set_count cuenta como nivel 1", () => {
    const cells = buildHeatmap([{ performed_on: "2026-09-01" }], {
      weeks: 2,
      endDate: WEDNESDAY,
    });
    expect(cells.find((c) => c.date === "2026-09-01")?.level).toBe(1);
  });

  it("suma varias sesiones del mismo día", () => {
    const cells = buildHeatmap(
      [
        { performed_on: "2026-09-01", set_count: 15 },
        { performed_on: "2026-09-01", set_count: 15 },
      ],
      { weeks: 2, endDate: WEDNESDAY },
    );
    const cell = cells.find((c) => c.date === "2026-09-01");
    expect(cell?.sets).toBe(30);
    expect(cell?.level).toBe(4);
  });

  it("ignora sesiones fuera del rango sin romperse", () => {
    const levels = buildLevels([{ performed_on: "2020-01-01", set_count: 30 }], {
      weeks: 4,
      endDate: WEDNESDAY,
    });
    expect(levels.every((level) => level === 0)).toBe(true);
  });

  it("marca como futuras las celdas posteriores a hoy", () => {
    const cells = buildHeatmap([], { weeks: 2, endDate: WEDNESDAY });
    // Thursday to Sunday.
    expect(cells.filter((cell) => cell.isFuture)).toHaveLength(4);
  });
});

describe("currentStreak", () => {
  it("cuenta días consecutivos hacia atrás desde hoy", () => {
    const sessions = [
      { performed_on: "2026-09-02" },
      { performed_on: "2026-09-01" },
      { performed_on: "2026-08-31" },
    ];
    expect(currentStreak(sessions, WEDNESDAY)).toBe(3);
  });

  it("no corta la racha si hoy todavía no se entrenó", () => {
    const sessions = [
      { performed_on: "2026-09-01" },
      { performed_on: "2026-08-31" },
    ];
    expect(currentStreak(sessions, WEDNESDAY)).toBe(2);
  });

  it("se corta ante un día salteado", () => {
    const sessions = [
      { performed_on: "2026-09-02" },
      { performed_on: "2026-08-31" },
    ];
    expect(currentStreak(sessions, WEDNESDAY)).toBe(1);
  });

  it("es cero sin sesiones", () => {
    expect(currentStreak([], WEDNESDAY)).toBe(0);
  });
});

describe("trainedDays", () => {
  it("cuenta días distintos con actividad, no sesiones", () => {
    const cells = buildHeatmap(
      [
        { performed_on: "2026-09-01" },
        { performed_on: "2026-09-01" },
        { performed_on: "2026-09-02" },
      ],
      { weeks: 4, endDate: WEDNESDAY },
    );
    expect(trainedDays(cells)).toBe(2);
  });
});

describe("heatmapStart", () => {
  it("es exactamente la primera celda de la grilla", () => {
    // If these drift apart, the query misses days that get drawn empty.
    for (const weeks of [4, 26, 53]) {
      const cells = buildHeatmap([], { weeks, endDate: WEDNESDAY });
      expect(heatmapStart({ weeks, endDate: WEDNESDAY })).toBe(cells[0].date);
    }
  });

  it("cae en el primer día de la semana", () => {
    expect(fromDateKey(heatmapStart({ endDate: WEDNESDAY })).getDay()).toBe(1);
    expect(
      fromDateKey(heatmapStart({ endDate: WEDNESDAY, weekStartsOn: 0 })).getDay(),
    ).toBe(0);
  });
});
