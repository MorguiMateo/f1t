import { useEffect } from "react";

/** No library: the photos are only 480px, so a plain overlay is enough. */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        autoFocus
        className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/10 text-lg text-white transition-colors hover:bg-white/20"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-xl object-contain"
      />
    </div>
  );
}
