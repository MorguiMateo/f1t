import { describe, expect, it } from "vitest";
import { backAction, backFallback, sectionForDestination, validateInternalDestination } from "./navigation";

describe("safe app navigation", () => {
  it.each(["/", "/comidas?fecha=2026-10-01", "/entrenar?dia=day-1&fecha=2026-10-01", "/rutinas/routine-1/dias/day-1", "/ejercicios/Barbell_Curl", "/ejercicios?rutina=r&dia=d&q=press&musculo=chest", "/perfil#objetivos", "/progreso?seccion=cuerpo&accion=anotar", "/perfil?seccion=objetivos"])("preserves the internal destination %s", (path) => {
    expect(validateInternalDestination(path)).toBe(path);
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%2f%2fevil.test", "/login", "/comidas\n", "/?code=secret", "/perfil#access_token=secret", "/rutinas/r/dias/d/extra", null, {}])("rejects external, unsupported or OAuth destinations: %s", (path) => {
    expect(validateInternalDestination(path)).toBeNull();
  });
  it("assigns a single owner to catalog, picker and workout routes", () => {
    expect(sectionForDestination("/ejercicios")).toBe("/rutinas");
    expect(sectionForDestination("/ejercicios/press")).toBe("/rutinas");
    expect(sectionForDestination("/rutinas/r/dias/d")).toBe("/rutinas");
    expect(sectionForDestination("/entrenar")).toBe("/");
    expect(sectionForDestination("/entrenar", { section: "/progreso" })).toBe("/progreso");
    expect(sectionForDestination("/entrenar", { section: "https://evil.test" })).toBe("/");
  });
  it.each([
    ["/ejercicios", "/rutinas"],
    ["/ejercicios?rutina=r&dia=d", "/rutinas/r/dias/d"],
    ["/ejercicios?rutina=//evil.test&dia=d", "/rutinas"],
    ["/ejercicios?rutina=r%3Ffoo%3Dbar&dia=d", "/rutinas"],
    ["/ejercicios/press", "/ejercicios"],
    ["/rutinas/r/dias/d", "/rutinas/r"],
    ["/rutinas/r", "/rutinas"],
    ["/entrenar?dia=d", "/"],
    ["/comidas", null],
  ])("provides a hierarchical fallback for %s", (path, fallback) => {
    expect(backFallback(path)).toBe(fallback);
  });
  it("uses only an app-owned previous entry, never browser history length or an external fallback", () => {
    expect(backAction(2, "/rutinas")).toEqual({ delta: -1 });
    for (const index of [undefined, null, 0, -1, "2", NaN]) {
      expect(backAction(index, "/rutinas")).toEqual({ to: "/rutinas", replace: true });
    }
    expect(backAction(0, "//evil.test")).toEqual({ to: "/", replace: true });
  });
});
