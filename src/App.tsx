import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./features/auth/RequireAuth";
import { ProfilePage } from "./pages/ProfilePage";
import { ProgressPage } from "./pages/ProgressPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { TodayPage } from "./pages/TodayPage";

/**
 * El catálogo se carga aparte.
 *
 * catalog.json son ~209 KB y react-body-highlighter otros ~176 KB, y las dos
 * cosas solo hacen falta en estas dos rutas. Metidas en el chunk inicial
 * duplicaban el peso de abrir la app, que es justo lo que no queremos en un
 * teléfono con señal de gimnasio. El service worker precachea los chunks
 * igual, así que offline no cambia: solo cambia el primer pintado.
 */
const ExercisesPage = lazy(() =>
  import("./pages/ExercisesPage").then((m) => ({ default: m.ExercisesPage })),
);
const ExerciseDetailPage = lazy(() =>
  import("./pages/ExerciseDetailPage").then((m) => ({
    default: m.ExerciseDetailPage,
  })),
);

function RouteFallback() {
  return (
    <p className="pt-16 text-center text-sm text-muted" role="status">
      Cargando…
    </p>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Nada es público: el guard envuelve el shell entero. */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<TodayPage />} />
          <Route path="rutinas" element={<RoutinesPage />} />
          {/* El catálogo no es una pestaña: se entra desde Rutinas, que es
              donde hace falta elegir ejercicios. La nav se queda en cuatro. */}
          <Route
            path="ejercicios"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ExercisesPage />
              </Suspense>
            }
          />
          <Route
            path="ejercicios/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ExerciseDetailPage />
              </Suspense>
            }
          />
          <Route path="progreso" element={<ProgressPage />} />
          <Route path="perfil" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
