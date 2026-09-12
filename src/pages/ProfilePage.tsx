import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { useUser } from "../features/auth/session";
import { supabase } from "../lib/supabase";

export function ProfilePage() {
  const user = useUser();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // El guard garantiza que hay usuario; esto es solo para TypeScript.
  if (!user) return null;

  const name = user.user_metadata.full_name ?? user.user_metadata.name ?? null;
  const avatarUrl =
    user.user_metadata.avatar_url ?? user.user_metadata.picture ?? null;

  async function signOut() {
    setIsSigningOut(true);
    // No hace falta limpiar estado: onAuthStateChange emite y el guard
    // vuelve a mostrar el login solo.
    await supabase.auth.signOut();
  }

  return (
    <>
      <PageHeader title="Perfil" subtitle="Tu cuenta y tus preferencias" />

      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl font-semibold text-muted">
            {(name ?? user.email ?? "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          {name ? <p className="truncate font-semibold">{name}</p> : null}
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Datos corporales</h2>
        <p className="mt-1 text-sm text-muted">
          Altura, objetivo y seguimiento de peso se agregan en la Fase 5.
        </p>
      </section>

      <button
        type="button"
        onClick={signOut}
        disabled={isSigningOut}
        className="mt-4 w-full rounded-xl border border-line bg-surface px-5 py-3.5 font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
      >
        {isSigningOut ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
    </>
  );
}
