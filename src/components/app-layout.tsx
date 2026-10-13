import { Suspense, lazy } from "react";
import { Outlet, useLocation } from "react-router";
import { BottomNav } from "./bottom-nav";
import { PageSkeleton } from "./skeleton";

// The catalog is only fetched as a lazy chunk, even though sync runs on every
// authenticated route rather than only when Today is visible.
const WidgetSync = lazy(() =>
  import("../features/sessions/widget-sync").then((m) => ({ default: m.WidgetSync })),
);

export function AppLayout() {
  const { pathname } = useLocation();
  const wide = /^\/(rutinas|ejercicios|progreso|perfil)\/?$/.test(pathname);
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {/* pb-28: room for the fixed nav plus the home indicator. */}
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">Saltar al contenido</a>
      <main id="contenido" tabIndex={-1} className={`mx-auto w-full ${wide ? "max-w-3xl" : "max-w-lg"} flex-1 px-4 pb-28 md:px-6`}>
        {/* Here rather than per `<Route>` so the nav stays on screen while a
            chunk downloads. */}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
      <Suspense fallback={null}><WidgetSync /></Suspense>
    </div>
  );
}
