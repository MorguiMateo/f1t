import { lazy } from "react";
import { Route, Routes } from "react-router";
import { AppLayout } from "./components/app-layout";
import { RequireAuth } from "./features/auth/require-auth";
import { ProfilePage } from "./pages/profile-page";
import { ProgressPage } from "./pages/progress-page";
import { RoutinesPage } from "./pages/routines-page";
import { TodayPage } from "./pages/today-page";

/**
 * What loads separately, and why.
 *
 * `catalog.json` is ~209 KB and react-body-highlighter another ~176 KB. Both
 * are only needed in here: the catalog and its entry page, the day editor,
 * and the routine detail with its muscle map. Put in the initial chunk they
 * doubled the cost of opening the app, which is exactly what we don't want
 * on a phone with gym reception. The service worker precaches the chunks
 * anyway, so offline doesn't change: only the first paint does.
 *
 * The `<Suspense>` covering them is in `AppLayout`, around the `Outlet`.
 */
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
      {/* Nothing is public: the guard wraps the entire shell. */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<TodayPage />} />
          {/* Logging a workout is its own screen and not a block inside
              Today: that way the back gesture leaves the workout, and the
              catalog it needs for the photos stays out of the initial chunk.
              `?dia=` trains a day other than today's. */}
          <Route path="entrenar" element={<WorkoutPage />} />
          <Route path="rutinas" element={<RoutinesPage />} />
          <Route path="rutinas/:routineId" element={<RoutineDetailPage />} />
          {/* A day is its own screen and not an accordion inside the
              routine: it has its own URL, so "back" from the catalog lands
              exactly on the day that was being edited. */}
          <Route
            path="rutinas/:routineId/dias/:dayId"
            element={<RoutineDayPage />}
          />
          {/* The catalog isn't a tab: you get to it from Routines, which is
              where picking exercises is needed. The nav stays at four. */}
          <Route path="ejercicios" element={<ExercisesPage />} />
          <Route path="ejercicios/:id" element={<ExerciseDetailPage />} />
          <Route path="progreso" element={<ProgressPage />} />
          <Route path="perfil" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
