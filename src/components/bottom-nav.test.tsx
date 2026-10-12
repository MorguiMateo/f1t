import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./bottom-nav";

function linksAt(path: string) {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );
  return [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([link]) => link);
}

describe("main navigation destinations", () => {
  it.each([
    ["/entrenar?dia=d", "/"],
    ["/ejercicios", "/rutinas"],
    ["/ejercicios?rutina=r&dia=d", "/rutinas"],
    ["/ejercicios/press", "/rutinas"],
    ["/rutinas/r/dias/d", "/rutinas"],
  ])("keeps exactly five destinations and selects the owner at %s", (path, owner) => {
    const links = linksAt(path);
    const active = links.filter((link) => link.includes('aria-current="page"'));
    expect(links).toHaveLength(5);
    expect(active).toHaveLength(1);
    expect(active[0]).toContain(`href="${owner}"`);
  });
  it.each(["/comidas", "/comidas/"])(
    "selects Comidas, not Hoy, when opening %s directly",
    (path) => {
      const links = linksAt(path);
      expect(links).toHaveLength(5);
      const active = links.filter((link) => link.includes('aria-current="page"'));
      expect(active).toHaveLength(1);
      expect(active[0]).toContain('href="/comidas"');
      expect(active[0]).toContain("Comidas");
    },
  );

  it.each(["/", "/rutinas", "/progreso", "/perfil"])(
    "keeps Comidas accessible without selecting it from %s",
    (path) => {
      const links = linksAt(path);
      const foods = links.find((link) => link.includes('href="/comidas"'));
      expect(foods).toBeDefined();
      expect(foods).not.toContain('aria-current="page"');
      expect(links.filter((link) => link.includes('aria-current="page"'))).toHaveLength(1);
    },
  );
});
