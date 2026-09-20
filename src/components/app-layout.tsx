import { Suspense } from "react";
import { Outlet } from "react-router";
import { BottomNav } from "./bottom-nav";

/**
 * The fallback for `lazy()` routes. It lives here, wrapping the `<Outlet>`,
 * rather than repeated on each `<Route>`: the shell — nav included — stays
 * on screen while the chunk downloads, so switching tabs never flashes
 * white.
 */
function RouteFallback() {
  return (
    <p className="pt-16 text-center text-sm text-muted" role="status">
      Cargando…
    </p>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {/* The bottom padding leaves room for the fixed nav plus the home
          indicator. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}
