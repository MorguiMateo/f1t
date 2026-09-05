import { PageHeader } from "../components/PageHeader";

export function ProfilePage() {
  return (
    <>
      <PageHeader title="Perfil" subtitle="Tu cuenta y tus preferencias" />
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="text-sm text-muted">
          El inicio de sesión con Google se agrega en la próxima fase.
        </p>
      </div>
    </>
  );
}
