import type { InputHTMLAttributes } from "react";

/** El input de texto de la app, con las clases del tema en un solo lugar. */
export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={[
        "rounded-xl border border-line bg-surface px-4 py-3 text-sm placeholder:text-muted",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
