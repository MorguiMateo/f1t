import type { ComponentProps, ReactNode } from "react";

/**
 * shadcn/ui's Skeleton (MIT), copied rather than installed: `shadcn init`
 * rewrites index.css with its own `--accent`. Uses `bg-surface-2` because our
 * accent is orange and a pulsing orange block reads as an alert. Blocks are
 * `aria-hidden` so screen readers only hear `SkeletonGroup`'s "Cargando…".
 */
export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={["rounded-md bg-surface-2 motion-safe:animate-pulse", className].join(" ")}
      {...props}
    />
  );
}

// A `1lh` box for the text size in `className`, with a shorter bar inside like
// glyphs: the placeholder matches the real line's height, so nothing shifts.
export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div className={["flex h-[1lh] items-center", className].join(" ")}>
      <Skeleton className="h-[0.75em] w-full" />
    </div>
  );
}

export function SkeletonGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  );
}

// Mirrors `PageHeader`'s padding.
function HeaderSkeleton() {
  return (
    <div
      className="pb-5"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)" }}
    >
      <SkeletonLine className="w-32 text-2xl" />
      <SkeletonLine className="mt-1 w-48 text-sm" />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <SkeletonLine className="w-40" />
      <SkeletonLine className="mt-1 w-24 text-sm" />
    </div>
  );
}

// Used while the session loads and while a `lazy()` route downloads: the next
// screen could be any tab, so this is the shape they all share.
export function PageSkeleton() {
  return (
    <SkeletonGroup>
      <HeaderSkeleton />
      <div className="flex flex-col gap-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </SkeletonGroup>
  );
}
