import { lazy } from "react";
import { Route, Routes } from "react-router";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./features/auth/RequireAuth";
import { ProfilePage } from "./pages/ProfilePage";
import { ProgressPage } from "./pages/ProgressPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { TodayPage } from "./pages/TodayPage";

/**
 * Lo que se carga aparte, y por qué.
 *
 * `catalog.json` son ~209 KB y react-body-highlighter otros ~176 KB. Las dos
 * cosas solo hacen falta acá adentro: el catálogo y su ficha, el editor de un
 * día y el detalle de la rutina con su mapa muscular. Metidas en el chunk
 * inicial duplicaban el peso de abrir la app, que es justo lo que no queremos
 * en un teléfono con señal de gimnasio. El service worker precachea los
 * chunks igual, así que offline no cambia: solo cambia el primer pintado.
 *
 * El `<Suspense>` que las cubre está en `AppLayout`, alrededor del `Outlet`.
 */
const ExercisesPage = lazy(() =>
  import("./pages/ExercisesPage").then((m) => ({ default: m.ExercisesPage })),
);
const ExerciseDetailPage = lazy(() =>
  import("./pages/ExerciseDetailPage").then((m) => ({
    default: m.ExerciseDetailPage,
  })),
);
const RoutineDetailPage = lazy(() =>
  import("./pages/RoutineDetailPage").then((m) => ({
    default: m.RoutineDetailPage,
  })),
);
const RoutineDayPage = lazy(() =>
  import("./pages/RoutineDayPage").then((m) => ({
    default: m.RoutineDayPage,
  })),
);
const WorkoutPage = lazy(() =>
  import("./pages/WorkoutPage").then((m) => ({ default: m.WorkoutPage })),
);

export default function App() {
  return (
    <Routes>
      {/* Nada es público: el guard envuelve el shell entero. */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<TodayPage />} />
          {/* Registrar el entrenamiento es otra pantalla y no un bloque
              dentro de Hoy: así el gesto de volver sale del entrenamiento,
              y el catálogo que necesita para las fotos no entra al chunk
              inicial. `?dia=` entrena un día que no es el de hoy. */}
          <Route path="entrenar" element={<WorkoutPage />} />
          <Route path="rutinas" element={<RoutinesPage />} />
          <Route path="rutinas/:routineId" element={<RoutineDetailPage />} />
          {/* El día es una pantalla propia y no un acordeón dentro de la
              rutina: tiene su propia URL, así que "volver" desde el catálogo
              cae exactamente en el día que se estaba editando. */}
          <Route
            path="rutinas/:routineId/dias/:dayId"
            element={<RoutineDayPage />}
          />
          {/* El catálogo no es una pestaña: se entra desde Rutinas, que es
              donde hace falta elegir ejercicios. La nav se queda en cuatro. */}
          <Route path="ejercicios" element={<ExercisesPage />} />
          <Route path="ejercicios/:id" element={<ExerciseDetailPage />} />
          <Route path="progreso" element={<ProgressPage />} />
          <Route path="perfil" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
