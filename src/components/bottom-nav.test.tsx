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
  ])("keeps exactly four destinations and selects the owner at %s", (path, owner) => {
    const links = linksAt(path);
    const active = links.filter((link) => link.includes('aria-current="page"'));
    expect(links).toHaveLength(4);
    expect(active).toHaveLength(1);
    expect(active[0]).toContain(`href="${owner}"`);
  });
  it("contains only the four supported tabs", () => {
    const links = linksAt("/progreso");
    expect(links).toHaveLength(4);
    expect(links.map(link => link.match(/href="([^"]+)"/)?.[1])).toEqual(["/", "/rutinas", "/progreso", "/perfil"]);
  });
});
