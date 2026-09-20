import { useEffect, useState } from "react";
import { Button } from "./Button";

/**
 * Un botón destructivo que pide confirmación en el mismo lugar.
 *
 * `window.confirm` sería una línea, pero en una PWA instalada abre el diálogo
 * del navegador —con su tipografía, su idioma y su aspecto de página web— en
 * el medio de algo que se ve como una app nativa. Acá el segundo toque
 * confirma, y si el usuario se distrae el botón vuelve solo a su estado
 * normal en vez de quedar armado esperando un toque accidental.
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
