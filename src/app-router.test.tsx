import deployment from "../vercel.json";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, matchRoutes, MemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./components/bottom-nav";

// Isolate routing from remote queries and device effects. Exercise the actual
// route definitions, data-router blocker API and production failure screens.
vi.mock("./features/auth/require-auth", () => ({ RequireAuth: () => <Outlet /> }));
vi.mock("./components/app-layout", () => ({ AppLayout: () => <><Outlet /><BottomNav /></> }));
vi.mock("./pages/today-page", () => ({ TodayPage: () => <h1>Hoy</h1> }));
import App, { appRoutes } from "./app";

function lastMatch(path: string) { return matchRoutes(appRoutes, path)?.at(-1)?.route.id; }

describe("production data router routes", () => {
  it.each([
    ["/", "today"], ["/entrenar?dia=day-1", "workout"], ["/comidas", "foods"],
    ["/rutinas", "routines"], ["/rutinas/r", "routine"], ["/rutinas/r/dias/d", "routine-day"],
    ["/ejercicios?rutina=r&dia=d&q=press", "exercises"], ["/ejercicios/press", "exercise"],
    ["/progreso?seccion=cuerpo&accion=anotar", "progress"], ["/perfil?seccion=objetivos", "profile"],
  ])("recognizes the existing feature contract for %s", (path, id) => { expect(lastMatch(path)).toBe(id); });

  it.each(["/rutinas/r/dias/", "/rutinas//dias/", "/pantalla-inexistente"])("offers recovery for an incomplete or unknown deep link %s", (path) => {
    expect(lastMatch(path)).toBe("not-found");
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    try {
      const html = renderToStaticMarkup(<RouterProvider router={router} />);
      expect(html).toContain("El enlace está incompleto o ya no existe");
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/rutinas"');
      expect([...html.matchAll(/<a\b[^>]*aria-current="page"/g)]).toHaveLength(1);
      expect(html).not.toContain("Unexpected Application Error");
    } finally { router.dispose(); }
  });

  it.each([["", "today"], ["/rutinas/", "routines"], ["/ejercicios/", "exercises"], ["/ejercicios?dia=&rutina=", "exercises"]])("matches a root or empty selector link deliberately: %s", (path, id) => { expect(lastMatch(path || "/")).toBe(id); });

  it("retains the default App export for MemoryRouter previews and tests", () => {
    const html = renderToStaticMarkup(<MemoryRouter><App /></MemoryRouter>);
    expect(html).toContain("Hoy</h1>");
    expect([...html.matchAll(/<a\b/g)]).toHaveLength(5);
  });

  it.each(["tab", "back", "forward", "direct-entry fallback"])("blocks a real data-router %s exit until the caller explicitly proceeds", async (exit) => {
    const direct = exit === "direct-entry fallback";
    const router = createMemoryRouter(appRoutes, {
      initialEntries: direct ? ["/entrenar?dia=d"] : ["/", "/entrenar?dia=d", "/perfil"],
      initialIndex: direct ? 0 : 1,
    });
    try {
      router.getBlocker("workout", () => true);
      const leave = () => exit === "back" ? router.navigate(-1) : exit === "forward" ? router.navigate(1)
        : router.navigate(direct ? "/" : "/comidas", { replace: direct });
      await leave();
      expect(router.state.location.pathname).toBe("/entrenar");
      let blocker = router.state.blockers.get("workout")!;
      expect(blocker.state).toBe("blocked");
      if (blocker.state === "blocked") blocker.reset();
      expect(router.state.location.search).toBe("?dia=d");
      await leave();
      blocker = router.state.blockers.get("workout")!;
      if (blocker.state === "blocked") blocker.proceed();
      await vi.waitFor(() => expect(router.state.location.pathname).toBe(exit === "forward" ? "/perfil" : exit === "tab" ? "/comidas" : "/"));
    } finally { router.dispose(); }
  });

  it("provides a controlled error and reload recovery instead of the router's raw stack screen", async () => {
    const failingRoutes = appRoutes.map((route) => ({ ...route, loader: () => { throw new Error("Failed to fetch"); } }));
    const router = createMemoryRouter(failingRoutes, { initialEntries: ["/rutinas/r/dias/d"] });
    try {
      await vi.waitFor(() => expect(router.state.initialized).toBe(true));
      expect(router.state.errors?.app).toBeInstanceOf(Error);
      const html = renderToStaticMarkup(<RouterProvider router={router} />);
      expect(html).toContain("No pudimos abrir la pantalla");
      expect(html).toContain("Revisá tu conexión");
      expect(html).toContain("Reintentar");
      expect(html).toContain("Detalle técnico");
      expect(html).not.toContain("Unexpected Application Error");
    } finally { router.dispose(); }
  });

  it("uses the configured deployment's root SPA rewrite for browser deep links", () => {
    expect(deployment.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
    expect(deployment.outputDirectory).toBe("dist");
  });
});
