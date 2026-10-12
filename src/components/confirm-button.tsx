import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "./button";

/** A native modal makes the rest of the page inert and traps keyboard focus. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  size = "md",
  className,
  title,
  description,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
  title?: string;
  description?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    // The safe action gets initial focus, not the irreversible one.
    cancel.current?.focus();
    return () => {
      element.close();
      if (trigger.current?.isConnected) trigger.current.focus();
      else {
        // Deleting a row may remove its opener. Leave focus at a meaningful
        // location in the current screen rather than on the document body.
        const document = trigger.current?.ownerDocument;
        const heading = document?.querySelector<HTMLElement>("main h1") ?? document?.querySelector<HTMLElement>("main");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    // The native close event updates React state through onClose.
    if (disabled && open) dialog.current?.close();
  }, [disabled, open]);

  return (
    <>
      <Button
        variant="danger"
        size={size}
        className={className}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (disabled) return;
          trigger.current = event.currentTarget;
          confirmed.current = false;
          setOpen(true);
        }}
      >{label}</Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="confirmation-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-surface p-5 text-ink shadow-xl"
        onCancel={(event) => { event.preventDefault(); setOpen(false); }}
        onClose={(event) => { if (!event.currentTarget.open) setOpen(false); }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">{title ?? `Confirmar: ${label}`}</h2>
        <div id={`${id}-description`} className="mt-2 text-sm text-muted">
          {description ?? "Revisá el registro antes de confirmar. Esta acción no se puede deshacer."}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button ref={cancel} onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="danger" disabled={disabled} onClick={() => {
            if (disabled || !open || confirmed.current) return;
            confirmed.current = true;
            setOpen(false);
            onConfirm();
          }}>{/^¿.*\?$/.test(confirmLabel) ? label : confirmLabel}</Button>
        </div>
      </dialog>
    </>
  );
}
