import { Outlet } from "react-router";
import { BottomNav } from "./BottomNav";

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {/* El padding inferior deja lugar a la nav fija más el home indicator. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
