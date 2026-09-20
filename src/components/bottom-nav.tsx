import { NavLink } from "react-router";
import {
  ProfileIcon,
  ProgressIcon,
  RoutinesIcon,
  TodayIcon,
} from "./nav-icons";

const TABS = [
  { to: "/", label: "Hoy", Icon: TodayIcon, end: true },
  { to: "/rutinas", label: "Rutinas", Icon: RoutinesIcon, end: false },
  { to: "/progreso", label: "Progreso", Icon: ProgressIcon, end: false },
  { to: "/perfil", label: "Perfil", Icon: ProfileIcon, end: false },
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación principal"
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium tracking-wide transition-colors",
                  isActive ? "text-accent" : "text-muted hover:text-ink-2",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={isActive ? "size-6" : "size-6 opacity-90"} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
