import { Route, Routes } from "react-router";
import { AppLayout } from "./components/AppLayout";
import { ProfilePage } from "./pages/ProfilePage";
import { ProgressPage } from "./pages/ProgressPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { TodayPage } from "./pages/TodayPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<TodayPage />} />
        <Route path="rutinas" element={<RoutinesPage />} />
        <Route path="progreso" element={<ProgressPage />} />
        <Route path="perfil" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
}
