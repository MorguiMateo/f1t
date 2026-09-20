import type { ButtonHTMLAttributes } from "react";

/**
 * El botón de la app.
 *
 * Aparece cuando la Fase 3 llenó las pantallas de acciones: hasta ahora había
 * dos botones en toda la app y repetir la cadena de clases alcanzaba. Con
 * quince, la cadena repetida es el lugar donde las pantallas se empiezan a
 * ver distintas entre sí sin que nadie lo haya decidido.
 */

type Variant = "primary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "border-accent bg-accent text-accent-ink hover:opacity-90",
  quiet: "border-line bg-surface text-ink hover:bg-surface-2",
  // No hay token de "peligro": el acento ya es rojo y usarlo acá haría que
  // borrar se vea igual de invitante que la acción principal. `warn` es el
  // único color del tema que dice "pará un segundo".
  danger: "border-line bg-surface text-warn hover:bg-surface-2",
};

const SIZES = {
  md: "rounded-xl px-4 py-3 text-sm",
  sm: "rounded-lg px-3 py-1.5 text-xs",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZES;
};

export function Button({
  variant = "quiet",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      // Sin type explícito, un botón dentro de un <form> envía el formulario.
      type={type}
      className={[
        "border font-medium transition-colors disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
      {...props}
    />
  );
}
