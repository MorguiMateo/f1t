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

  it("le da a cada ejercicio nombre en inglés y alias de búsqueda", () => {
    const broken = EXERCISES.filter(
      (e) => !e.nameEn || !Array.isArray(e.aliases) || e.aliases.length === 0,
    );
    expect(broken).toEqual([]);
  });

  it("no repite el nombre visible entre dos ejercicios", () => {
    const names = EXERCISES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
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

  it("busca por nombre en inglés aunque el nombre visible esté en español", () => {
    // El nombre en pantalla es "Press de banca"; el inglés vive en el índice.
    const ids = search("bench press").map((e) => e.id);
    expect(ids).toContain("Barbell_Bench_Press_-_Medium_Grip");
  });

  it("busca por el nombre en español", () => {
    const ids = search("press banca").map((e) => e.id);
    expect(ids).toContain("Barbell_Bench_Press_-_Medium_Grip");
  });

  it("encuentra por un alias en español que no está en el nombre", () => {
    // "pecho plano" no aparece en "Press de banca": lo resuelve el alias.
    const ids = search("pecho plano").map((e) => e.id);
    expect(ids).toContain("Barbell_Bench_Press_-_Medium_Grip");
  });

  it("encuentra el peso muerto por su alias regional", () => {
    const ids = search("peso muerto").map((e) => e.id);
    expect(ids).toContain("Barbell_Deadlift");
  });

  it("busca por músculo en español, aunque el nombre esté en inglés", () => {
    // Es la razón de existir del índice: nadie va a escribir "chest".
    // No exige exclusividad: "jalón al pecho" es el nombre real de varios
    // jalones dorsales, así que la palabra "pecho" también los alcanza. Lo que
    // importa es que el trabajo de pecho aparece y domina; el chip de músculo
    // es la herramienta exacta cuando hace falta filtrar sin ruido.
    const hits = search("pecho");
    const chest = hits.filter((e) =>
      [...e.primaryMuscles, ...e.secondaryMuscles].includes("chest"),
    );
    expect(chest.length).toBeGreaterThan(5);
    expect(chest.length).toBeGreaterThan(hits.length - chest.length);
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
    // El nombre visible es español ("Sentadilla…"); el término inglés matchea
    // por nameEn o por los alias, así que se valida contra el índice.
    expect(hits.every((e) => index.get(e.id)?.includes("squat"))).toBe(true);
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
    expect(squat?.name).toBe("Sentadilla con barra");
    expect(squat?.nameEn).toBe("Barbell Squat");
  });

  it("devuelve undefined si el id no existe", () => {
    expect(getExercise("No_Existe")).toBeUndefined();
  });
});
