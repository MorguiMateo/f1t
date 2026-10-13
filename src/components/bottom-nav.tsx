import { Link, useLocation } from "react-router";
import { sectionForDestination } from "./navigation";
import {
  ProfileIcon,
  ProgressIcon,
  RoutinesIcon,
  TodayIcon,
} from "./nav-icons";

const TABS = [
  { to: "/", label: "Hoy", Icon: TodayIcon },
  { to: "/rutinas", label: "Rutinas", Icon: RoutinesIcon },
  { to: "/progreso", label: "Progreso", Icon: ProgressIcon },
  { to: "/perfil", label: "Perfil", Icon: ProfileIcon },
];

export function BottomNav() {
  const location = useLocation();
  const activeSection = sectionForDestination(location.pathname, location.state);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación principal"
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="min-w-0 flex-1">
            <Link
              to={to}
              aria-current={activeSection === to ? "page" : undefined}
              className={[
                  "flex min-h-14 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  activeSection === to ? "text-accent" : "text-muted hover:text-ink-2",
              ].join(" ")}
            >
              <Icon className={activeSection === to ? "size-6" : "size-6 opacity-90"} />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
