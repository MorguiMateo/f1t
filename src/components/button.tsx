import type { ButtonHTMLAttributes, Ref } from "react";

type Variant = "primary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "border-accent bg-accent text-accent-ink hover:opacity-90",
  quiet: "border-control bg-surface text-ink hover:bg-surface-2",
  // Not the accent: it's already red and would make deleting look as inviting
  // as the primary action.
  danger: "border-control bg-surface text-warn hover:bg-surface-2",
};

const SIZES = {
  md: "rounded-xl px-4 py-3 text-sm",
  sm: "rounded-lg px-3 py-1.5 text-xs",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZES;
  ref?: Ref<HTMLButtonElement>;
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
      // Without an explicit type, a button inside a <form> submits it.
      type={type}
      className={[
        "inline-flex min-h-11 min-w-11 items-center justify-center border font-medium transition-colors disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
      {...props}
    />
  );
}
