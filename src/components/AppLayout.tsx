import { Suspense } from "react";
import { Outlet } from "react-router";
import { BottomNav } from "./BottomNav";

/**
 * El fallback de las rutas `lazy()`. Vive acá, envolviendo al `<Outlet>`, y
 * no repetido en cada `<Route>`: el shell —header de nav incluido— se queda
 * en pantalla mientras baja el chunk, así que cambiar de pestaña nunca
 * parpadea en blanco.
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
      {/* El padding inferior deja lugar a la nav fija más el home indicator. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}
