import { NavLink } from "react-router";

/** Keep both destinations reachable before a long list on small screens. */
export function RoutineNavigation() {
  return (
    <nav aria-label="Rutinas y ejercicios" className="mb-4 flex gap-2">
      {[["/rutinas", "Mis rutinas"], ["/ejercicios", "Ejercicios"]].map(([to, label]) => (
        <NavLink key={to} to={to} className={({ isActive }) =>
          `rounded-lg border px-4 py-2 text-sm font-medium ${isActive ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`
        }>{label}</NavLink>
      ))}
    </nav>
  );
}
