import { lazy } from "react";
import { Route, Routes } from "react-router";
import { AppLayout } from "./components/app-layout";
import { RequireAuth } from "./features/auth/require-auth";
import { ProfilePage } from "./pages/profile-page";
import { ProgressPage } from "./pages/progress-page";
import { RoutinesPage } from "./pages/routines-page";
import { TodayPage } from "./pages/today-page";

// Keep the catalog and body-highlighter out of the initial chunk. The service
// worker precaches lazy chunks for offline use; `AppLayout` owns Suspense.
const ExercisesPage = lazy(() =>
  import("./pages/exercises-page").then((m) => ({ default: m.ExercisesPage })),
);
const ExerciseDetailPage = lazy(() =>
  import("./pages/exercise-detail-page").then((m) => ({
    default: m.ExerciseDetailPage,
  })),
);
const RoutineDetailPage = lazy(() =>
  import("./pages/routine-detail-page").then((m) => ({
    default: m.RoutineDetailPage,
  })),
);
const RoutineDayPage = lazy(() =>
  import("./pages/routine-day-page").then((m) => ({
    default: m.RoutineDayPage,
  })),
);
const WorkoutPage = lazy(() =>
  import("./pages/workout-page").then((m) => ({ default: m.WorkoutPage })),
);

export default function App() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<TodayPage />} />
          {/* Its own screen, not a block in Today, so the back gesture
              leaves the workout. `?dia=` trains a day other than today's. */}
          <Route path="entrenar" element={<WorkoutPage />} />
          <Route path="rutinas" element={<RoutinesPage />} />
          <Route path="rutinas/:routineId" element={<RoutineDetailPage />} />
          {/* Its own URL so "back" from the catalog lands on this day. */}
          <Route
            path="rutinas/:routineId/dias/:dayId"
            element={<RoutineDayPage />}
          />
          {/* Not a tab: reached from Routines, keeping the nav at four. */}
          <Route path="ejercicios" element={<ExercisesPage />} />
          <Route path="ejercicios/:id" element={<ExerciseDetailPage />} />
          <Route path="progreso" element={<ProgressPage />} />
          <Route path="perfil" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
