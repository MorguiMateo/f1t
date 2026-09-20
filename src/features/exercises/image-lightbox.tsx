import { useEffect } from "react";

/**
 * Full-screen viewer for enlarging an exercise image.
 *
 * No dependencies: the catalog photos are 480px WebP, so an overlay with the
 * same image is enough to see it big. It closes on a tap anywhere or on
 * Escape — the most intuitive thing on a phone — and locks background
 * scrolling while it is open.
 */
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
    // Keep the background from scrolling behind the viewer.
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
      {/* object-contain so nothing is cropped: here the point is the whole photo. */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-xl object-contain"
      />
    </div>
  );
}
