import { useEffect, useRef } from "react";

/** A native modal keeps keyboard focus inside the image overlay. */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={alt}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCloseRef.current();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-4 text-white backdrop:bg-black/85 backdrop:backdrop-blur-sm"
    >
      <div className="pointer-events-none flex h-full items-center justify-center">
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Cerrar"
          autoFocus
          className="pointer-events-auto absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/10 text-lg transition-colors hover:bg-white/20"
        >
          ✕
        </button>
        <img
          src={src}
          alt={alt}
          className="pointer-events-auto max-h-full max-w-full rounded-xl object-contain"
        />
      </div>
    </dialog>
  );
}
