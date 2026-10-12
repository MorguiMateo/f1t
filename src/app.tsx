import { lazy } from "react";
import { type RouteObject, useRoutes } from "react-router";
import { AppLayout } from "./components/app-layout";
import { RequireAuth } from "./features/auth/require-auth";
import { TodayPage } from "./pages/today-page";
import { RouteFailure, UnknownDestination } from "./components/route-fallback";

// Keep the catalog and body-highlighter out of the initial chunk. The service
// worker precaches lazy chunks for offline use; `AppLayout` owns Suspense.
const ProfilePage = lazy(() =>
  import("./pages/profile-page").then((m) => ({ default: m.ProfilePage })),
);
const ProgressPage = lazy(() =>
  import("./pages/progress-page").then((m) => ({ default: m.ProgressPage })),
);
const RoutinesPage = lazy(() =>
  import("./pages/routines-page").then((m) => ({ default: m.RoutinesPage })),
);
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
const FoodDiaryPage = lazy(() =>
  import("./features/foods/food-diary-page").then((m) => ({ default: m.FoodDiaryPage })),
);

/** Shared definitions: production uses a data router so every exit can be blocked. */
// eslint-disable-next-line react/only-export-components -- Bootstrap and legacy App previews share one route tree.
export const appRoutes: RouteObject[] = [{
  id: "app",
  path: "/",
  element: <RequireAuth />,
  errorElement: <RouteFailure />,
  children: [{
    id: "shell",
    element: <AppLayout />,
    children: [
      { id: "today", index: true, element: <TodayPage /> },
      // Its own screen so the back gesture leaves the workout; `?dia=` selects a day.
      { id: "workout", path: "entrenar", element: <WorkoutPage /> },
      { id: "foods", path: "comidas", element: <FoodDiaryPage /> },
      { id: "routines", path: "rutinas", element: <RoutinesPage /> },
      { id: "routine", path: "rutinas/:routineId", element: <RoutineDetailPage /> },
      { id: "routine-day", path: "rutinas/:routineId/dias/:dayId", element: <RoutineDayPage /> },
      // Not a sixth tab: the catalog belongs to Rutinas.
      { id: "exercises", path: "ejercicios", element: <ExercisesPage /> },
      { id: "exercise", path: "ejercicios/:id", element: <ExerciseDetailPage /> },
      { id: "progress", path: "progreso", element: <ProgressPage /> },
      { id: "profile", path: "perfil", element: <ProfilePage /> },
      { id: "not-found", path: "*", element: <UnknownDestination /> },
    ],
  }],
}];

/** Keep the component export for existing MemoryRouter previews/tests. */
export default function App() {
  return useRoutes(appRoutes);
}
