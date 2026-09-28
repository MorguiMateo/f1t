import { Suspense } from "react";
import { Outlet } from "react-router";
import { BottomNav } from "./bottom-nav";
import { PageSkeleton } from "./skeleton";

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {/* pb-28: room for the fixed nav plus the home indicator. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28">
        {/* Here rather than per `<Route>` so the nav stays on screen while a
            chunk downloads. */}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}
