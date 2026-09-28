import { describe, expect, it } from "vitest";
import { KEY_MUSCLES, exerciseIdsOf, muscleCoverage } from "./coverage";

const BENCH = "Barbell_Bench_Press_-_Medium_Grip";
const SQUAT = "Barbell_Full_Squat";
const PULLUPS = "Pullups";
const CURL = "Barbell_Curl";

describe("muscleCoverage", () => {
  it("con la rutina vacía todo lo importante falta", () => {
    const coverage = muscleCoverage([]);
    expect(coverage.exerciseCount).toBe(0);
    expect(coverage.primary).toEqual([]);
    expect(coverage.missing).toEqual([...KEY_MUSCLES]);
  });

  it("separa primarios de secundarios", () => {
    const coverage = muscleCoverage([BENCH]);
    expect(coverage.primary).toEqual(["chest"]);
    expect(coverage.secondary).toEqual(["shoulders", "triceps"]);
  });

  it("no cuenta dos veces un músculo que es primario en otro ejercicio", () => {
    // Biceps are secondary in pull-ups but primary in curls.
    const coverage = muscleCoverage([PULLUPS, CURL]);
    expect(coverage.primary).toContain("biceps");
    expect(coverage.secondary).not.toContain("biceps");
  });

  it("ordena por anatomía y no por orden de aparición", () => {
    const coverage = muscleCoverage([SQUAT, BENCH]);
    expect(coverage.primary).toEqual(["chest", "quadriceps"]);
  });

  it("marca como falta solo los grupos grandes sin trabajo", () => {
    const coverage = muscleCoverage([BENCH, SQUAT, PULLUPS]);
    expect(coverage.missing).not.toContain("chest");
    expect(coverage.missing).toContain("abdominals");
    expect(coverage.missing).not.toContain("neck");
    expect(coverage.missing).not.toContain("abductors");
  });

  it("ignora ids que ya no están en el catálogo", () => {
    const coverage = muscleCoverage([BENCH, "Ejercicio_Que_No_Existe"]);
    expect(coverage.exerciseCount).toBe(1);
    expect(coverage.primary).toEqual(["chest"]);
  });
});

describe("exerciseIdsOf", () => {
  it("aplana los días de la rutina en un solo array", () => {
    expect(
      exerciseIdsOf([
        { exercises: [{ exercise_id: BENCH }, { exercise_id: CURL }] },
        { exercises: [] },
        { exercises: [{ exercise_id: SQUAT }] },
      ]),
    ).toEqual([BENCH, CURL, SQUAT]);
  });
});
