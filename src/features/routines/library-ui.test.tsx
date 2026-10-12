import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ExerciseCard } from "../exercises/exercise-card";
import { EXERCISES } from "../exercises/catalog";
import { RoutineCoverage } from "./routine-coverage";

describe("selection semantics and contextual coverage", () => {
  it("keeps technique independently reachable even when an exercise is already added", () => {
    const select = vi.fn();
    const html = renderToStaticMarkup(<MemoryRouter><ul><ExerciseCard exercise={EXERCISES[0]} onSelect={select} added detailsTo="/ejercicios/bench?dia=day&amp;rutina=routine" /></ul></MemoryRouter>);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Ya está en el día");
    expect(html).toMatch(/<a[^>]*href="\/ejercicios\/bench/);
    expect(html).toContain("Ver técnica y fotos");
    expect(select).not.toHaveBeenCalled();
  });
  it("does not warn that a split day must cover the whole body", () => {
    const html = renderToStaticMarkup(<RoutineCoverage exerciseIds={[EXERCISES[0].id]} />);
    expect(html).toContain("Trabaja:");
    expect(html).not.toContain("No incluido en esta rutina:");
    expect(html).not.toContain("Sin trabajo:");
    expect(html).toContain("No evalúa volumen, frecuencia ni suficiencia");
  });
  it("limits missing groups to the weekly routine without making a sufficiency claim", () => {
    const html = renderToStaticMarkup(<RoutineCoverage exerciseIds={[EXERCISES[0].id]} weekly />);
    expect(html).toContain("No incluido en esta rutina:");
    expect(html).not.toContain("No queda ningún grupo grande sin entrenar");
  });
});
