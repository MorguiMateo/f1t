import { describe, expect, it } from "vitest";
import {
  EXERCISES,
  availableEquipment,
  availableMuscles,
  buildSearchIndex,
  filterExercises,
  getExercise,
  normalize,
  type Exercise,
} from "./catalog";
import { EQUIPMENT_ES, MUSCLES, muscleLabel } from "../../lib/muscles";

const equipmentLabel = (e: string | null) => (e ? EQUIPMENT_ES[e] ?? e : "");
const index = new Map(
  EXERCISES.map((e) => [e.id, buildSearchIndex(e, muscleLabel, equipmentLabel)]),
);
const search = (query: string) =>
  filterExercises(EXERCISES, { query }, index);

describe("normalize", () => {
  it("saca acentos y mayúsculas", () => {
    expect(normalize("Bíceps")).toBe("biceps");
    expect(normalize("Cuádriceps")).toBe("cuadriceps");
  });
});

describe("el catálogo generado", () => {
  it("tiene los 165 ejercicios curados", () => {
    expect(EXERCISES).toHaveLength(165);
  });

  it("cubre los 17 músculos del dataset como primarios", () => {
    expect(availableMuscles(EXERCISES).sort()).toEqual([...MUSCLES].sort());
  });

  it("le da dos imágenes a cada ejercicio", () => {
    const broken = EXERCISES.filter((e) => e.images.length !== 2);
    expect(broken).toEqual([]);
  });

  it("apunta las imágenes a rutas servibles", () => {
    for (const e of EXERCISES) {
      expect(e.images[0]).toBe(`/exercises/${e.id}/0.webp`);
    }
  });

  it("no ofrece equipamiento que no exista en el catálogo", () => {
    const declared = availableEquipment(EXERCISES);
    expect(declared).not.toContain(null);
    expect(declared.length).toBeGreaterThan(5);
  });
});

describe("filterExercises", () => {
  it("sin filtros devuelve todo", () => {
    expect(filterExercises(EXERCISES, {})).toHaveLength(EXERCISES.length);
  });

  it("busca por nombre en inglés", () => {
    const names = search("bench press").map((e) => e.name);
    expect(names).toContain("Barbell Bench Press - Medium Grip");
  });

  it("busca por músculo en español, aunque el nombre esté en inglés", () => {
    // Es la razón de existir del índice: nadie va a escribir "chest".
    const hits = search("pecho");
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.every((e) =>
      [...e.primaryMuscles, ...e.secondaryMuscles].includes("chest"),
    )).toBe(true);
  });

  it("pide que estén todos los términos, en cualquier orden", () => {
    const a = search("mancuernas pecho");
    const b = search("pecho mancuernas");
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.every((e) => e.equipment === "dumbbell")).toBe(true);
  });

  it("filtra por músculo incluyendo los secundarios", () => {
    const hits = filterExercises(EXERCISES, { muscle: "triceps" });
    const onlySecondary = hits.filter(
      (e) => !e.primaryMuscles.includes("triceps"),
    );
    // El press de banca trabaja tríceps sin ser su músculo primario.
    expect(onlySecondary.length).toBeGreaterThan(0);
  });

  it("filtra por equipamiento", () => {
    const hits = filterExercises(EXERCISES, { equipment: "barbell" });
    expect(hits.length).toBeGreaterThan(10);
    expect(hits.every((e) => e.equipment === "barbell")).toBe(true);
  });

  it("combina búsqueda y filtros", () => {
    const hits = filterExercises(
      EXERCISES,
      { query: "squat", equipment: "barbell" },
      index,
    );
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every((e) => e.equipment === "barbell")).toBe(true);
    expect(hits.every((e) => normalize(e.name).includes("squat"))).toBe(true);
  });

  it("devuelve vacío y no explota cuando no hay coincidencias", () => {
    expect(search("zzzzz")).toEqual([]);
  });

  it("ignora espacios de sobra", () => {
    expect(search("   bench   press  ").length).toBe(search("bench press").length);
  });
});

describe("getExercise", () => {
  it("resuelve por id", () => {
    const squat: Exercise | undefined = getExercise("Barbell_Squat");
    expect(squat?.name).toBe("Barbell Squat");
  });

  it("devuelve undefined si el id no existe", () => {
    expect(getExercise("No_Existe")).toBeUndefined();
  });
});
