import { useEffect, useState } from "react";
import { Button } from "./button";

/**
 * A destructive button that asks for confirmation in place.
 *
 * `window.confirm` would be one line, but in an installed PWA it opens the
 * browser's dialog — with its own typeface, language and web-page look —
 * right in the middle of something that reads as a native app. Here the
 * second tap confirms, and if the user gets distracted the button returns to
 * its normal state on its own instead of sitting armed waiting for an
 * accidental tap.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  size = "md",
  className,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
}) {
  const [isArmed, setIsArmed] = useState(false);

  useEffect(() => {
    if (!isArmed) return;
    const timer = setTimeout(() => setIsArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [isArmed]);

  return (
    <Button
      variant="danger"
      size={size}
      className={className}
      disabled={disabled}
      aria-live="polite"
      onClick={() => {
        if (!isArmed) {
          setIsArmed(true);
          return;
        }
        setIsArmed(false);
        onConfirm();
      }}
    >
      {isArmed ? confirmLabel : label}
    </Button>
  );
}
