import type { ComponentProps, ReactNode } from "react";

/**
 * Loading placeholders: the shape of what is about to appear, instead of a
 * "Cargando…" that gets replaced by something of a completely different
 * height.
 *
 * `Skeleton` is shadcn/ui's (https://ui.shadcn.com/docs/components/skeleton,
 * MIT), copied in the way shadcn intends rather than installed with its CLI:
 * `shadcn init` rewrites index.css with its own theme, whose `--accent` is not
 * ours. Two changes to the original:
 *
 * - `bg-surface-2` instead of `bg-accent`. Here the accent is the orange of
 *   the primary button, and a pulsing orange block reads as an alert.
 * - The pulse only under `motion-safe`, so "reduce motion" gets a still grey
 *   block.
 *
 * Every block is `aria-hidden`: a screen reader hears the one "Cargando…"
 * that `SkeletonGroup` announces, not a dozen empty divs.
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

/**
 * A skeleton exactly one line of text tall, for the text size in
 * `className` (`text-sm`, `text-2xl`…). The box is `1lh` high and the grey bar
 * inside it is shorter, the way glyphs are: that keeps the real line and its
 * placeholder the same height, so nothing moves when the data lands.
 */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div className={["flex h-[1lh] items-center", className].join(" ")}>
      <Skeleton className="h-[0.75em] w-full" />
    </div>
  );
}

/**
 * The wrapper for a composed skeleton. `role="status"` plus a visually hidden
 * "Cargando…" is what `LoadingNote` used to announce, so assistive tech keeps
 * hearing the same thing.
 */
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

/**
 * The same padding as `PageHeader`, with its title and subtitle as
 * placeholders. For waits where not even the title is known yet.
 */
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

/** A card of the kind every list in the app is made of: title and a line. */
export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <SkeletonLine className="w-40" />
      <SkeletonLine className="mt-1 w-24 text-sm" />
    </div>
  );
}

/**
 * A whole page whose content isn't known: while the session is read at
 * startup, and while a `lazy()` route's code downloads. Either way the next
 * screen could be any tab, so this is the shape they share — a header and a
 * few cards.
 */
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
