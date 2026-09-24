import type { ButtonHTMLAttributes } from "react";

/**
 * The app's button.
 *
 * It showed up when Phase 3 filled the screens with actions: until then
 * there were two buttons in the whole app and repeating the class string was
 * enough. At fifteen, the repeated string is where screens start looking
 * different from each other without anyone having decided so.
 */

type Variant = "primary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "border-accent bg-accent text-accent-ink hover:opacity-90",
  quiet: "border-line bg-surface text-ink hover:bg-surface-2",
  // There is no "danger" token: the accent is already red, and using it here
  // would make deleting look as inviting as the primary action. `warn` is the
  // only colour in the theme that says "hold on a second".
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
      // Without an explicit type, a button inside a <form> submits it.
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
