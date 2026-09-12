import { Outlet } from "react-router";
import { useSession } from "./session";
import { SignInScreen } from "./SignInScreen";

/**
 * El guard de rutas. Envuelve todo lo que necesita un `user_id`.
 *
 * No redirige a /login: la app es de un solo usuario y no hay nada público,
 * así que la pantalla de login ocupa el lugar del contenido. Eso evita
 * además el parpadeo de una navegación en el arranque.
 */
export function RequireAuth() {
  const { session, isLoading } = useSession();

  // Sin esto se vería el login por un instante cada vez que recargás con
  // sesión válida, porque leer el storage no es sincrónico.
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ground">
        <p className="text-sm text-muted" role="status">
          Cargando…
        </p>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <Outlet />;
}
