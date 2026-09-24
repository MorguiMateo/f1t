import { Suspense } from "react";
import { Outlet } from "react-router";
import { BottomNav } from "./bottom-nav";
import { PageSkeleton } from "./skeleton";

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {/* The bottom padding leaves room for the fixed nav plus the home
          indicator. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28">
        {/* The fallback for `lazy()` routes lives here, wrapping the
            `<Outlet>`, rather than repeated on each `<Route>`: the shell —
            nav included — stays on screen while the chunk downloads, so
            switching tabs never flashes white. */}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}
