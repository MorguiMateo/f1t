import { useEffect, useState } from "react";
import { PageHeader } from "../components/page-header";
import { ErrorNote } from "../components/status";
import { useUser } from "../features/auth/session";
import { ReminderSettings } from "../features/activity/reminder-settings";
import {
  BodyProfileForm,
  BodyProfileFormSkeleton,
} from "../features/body/body-profile-form";
import {
  EnergyCard,
  EnergyCardSkeleton,
} from "../features/body/energy-card";
import { useBodyProfile } from "../features/body/queries";
import { device, signOutAfterDeviceCleanup } from "../lib/device";
import { supabase } from "../lib/supabase";

export function ProfilePage() {
  const user = useUser();
  const { data: profile, isPending, error } = useBodyProfile();
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target && !isPending) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [isPending]);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);

  // Only for TypeScript: the guard guarantees a user.
  if (!user) return null;

  const name = user.user_metadata.full_name ?? user.user_metadata.name ?? null;
  const avatarUrl =
    user.user_metadata.avatar_url ?? user.user_metadata.picture ?? null;

  async function signOut() {
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      // Do not let Supabase emit SIGNED_OUT (and unmount this page) while the
      // widget payload or locally scheduled reminder still belongs to us.
      const { error } = await signOutAfterDeviceCleanup(device, () => supabase.auth.signOut());
      if (error) setSignOutError(error);
      // On success, onAuthStateChange makes the guard show sign-in.
    } catch (reason) {
      setSignOutError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <PageHeader title="Perfil" subtitle="Tu objetivo, datos para estimaciones y preferencias" />


      <div className="mt-4">
        {isPending ? (
          <>
            <BodyProfileFormSkeleton />
            <div className="mt-4">
              <EnergyCardSkeleton />
            </div>
          </>
        ) : null}
        {error ? <ErrorNote error={error} /> : null}
        {/* Keep controlled drafts mounted when a background refetch fails. */}
        {!isPending && profile !== undefined ? (
          <>
            <BodyProfileForm profile={profile ?? null} />
            {/* Reads the same profile cache the form writes on each blur, so
                the numbers follow every saved field. */}
            <div className="mt-4">
              <EnergyCard />
            </div>
          </>
        ) : null}
      </div>

      <section className="mt-4" aria-label="Preferencias de entrenamiento"><ReminderSettings /></section>
      <section className="mt-6" aria-labelledby="account-heading">
        <h2 id="account-heading" className="mb-3 font-semibold">Cuenta</h2>
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


      <button
        type="button"
        onClick={signOut}
        disabled={isSigningOut}
        className="mt-4 w-full rounded-xl border border-line bg-surface px-5 py-3.5 font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
      >
        {isSigningOut ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      </section>
      {signOutError ? (
        <div className="mt-3">
          <ErrorNote error={signOutError} title="No se pudo cerrar sesión" />
        </div>
      ) : null}
    </>
  );
}
