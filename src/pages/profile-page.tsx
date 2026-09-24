import { useState } from "react";
import { PageHeader } from "../components/page-header";
import { ErrorNote } from "../components/status";
import { useUser } from "../features/auth/session";
import {
  BodyProfileForm,
  BodyProfileFormSkeleton,
} from "../features/body/body-profile-form";
import { useBodyProfile } from "../features/body/queries";
import { supabase } from "../lib/supabase";

export function ProfilePage() {
  const user = useUser();
  const { data: profile, isPending, error } = useBodyProfile();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // The guard guarantees there is a user; this is only for TypeScript.
  if (!user) return null;

  const name = user.user_metadata.full_name ?? user.user_metadata.name ?? null;
  const avatarUrl =
    user.user_metadata.avatar_url ?? user.user_metadata.picture ?? null;

  async function signOut() {
    setIsSigningOut(true);
    // No state to clear: onAuthStateChange fires and the guard shows the
    // sign-in screen again on its own.
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

      <div className="mt-4">
        {isPending ? <BodyProfileFormSkeleton /> : null}
        {error ? <ErrorNote error={error} /> : null}
        {/* The form is held back until the query resolves: its inputs are
            uncontrolled, so `defaultValue` is read once and a profile that
            arrives later would never reach the fields. `profile` being null
            is a real answer — an account that never filled it in — and the
            form starts empty. */}
        {!isPending && !error ? (
          <BodyProfileForm profile={profile ?? null} />
        ) : null}
      </div>

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
