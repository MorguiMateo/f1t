import { describe, expect, it } from "vitest";
import {
  WEEK_ORDER,
  dayForWeekday,
  nextTrainingDay,
  todayWeekday,
  weekdayLabel,
  whenLabel,
} from "./weekdays";

const days = [
  { weekday: 1, label: "Empuje" },
  { weekday: 3, label: "Tracción" },
  { weekday: 5, label: "Pierna" },
];

describe("el vocabulario de la semana", () => {
  it("usa 0 = domingo, igual que Date#getDay()", () => {
    expect(weekdayLabel(0)).toBe("Domingo");
    // 2026-09-17 fue un jueves.
    expect(todayWeekday(new Date(2026, 8, 17))).toBe(4);
  });

  it("muestra la semana de lunes a domingo", () => {
    expect([...WEEK_ORDER]).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("dayForWeekday", () => {
  it("encuentra el día que toca", () => {
    expect(dayForWeekday(days, 3)?.label).toBe("Tracción");
  });

  it("devuelve null cuando ese día es descanso", () => {
    expect(dayForWeekday(days, 2)).toBeNull();
  });
});

describe("nextTrainingDay", () => {
  it("mira hacia adelante desde mañana", () => {
    expect(nextTrainingDay(days, 1)).toEqual({ day: days[1], inDays: 2 });
  });

  it("da la vuelta a la semana", () => {
    expect(nextTrainingDay(days, 5)).toEqual({ day: days[0], inDays: 3 });
  });

  it("con un solo día devuelve ese mismo día la semana que viene", () => {
    const only = [{ weekday: 2, label: "Full body" }];
    expect(nextTrainingDay(only, 2)).toEqual({ day: only[0], inDays: 7 });
  });

  it("devuelve null si la rutina no tiene días", () => {
    expect(nextTrainingDay([], 2)).toBeNull();
  });
});

describe("whenLabel", () => {
  it("dice mañana en vez de nombrar el día", () => {
    expect(whenLabel(1, 2)).toBe("mañana");
  });

  it("nombra el día dentro de la semana", () => {
    expect(whenLabel(3, 4)).toBe("el jueves");
  });

  it("aclara cuando es la vuelta completa", () => {
    expect(whenLabel(7, 2)).toBe("el martes que viene");
  });
});
