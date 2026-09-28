import { useEffect, useState } from "react";
import { Button } from "./button";

// Not `window.confirm`: in an installed PWA it opens a browser-styled dialog
// that breaks the native feel. Disarms itself so it can't wait for a stray tap.
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
