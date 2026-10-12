import type { InputHTMLAttributes } from "react";

export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={[
        "min-h-11 rounded-xl border border-control bg-surface px-4 py-3 text-sm placeholder:text-muted",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
