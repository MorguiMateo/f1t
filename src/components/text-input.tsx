import type { InputHTMLAttributes } from "react";

/** The app's text input, with the theme classes in one place. */
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
