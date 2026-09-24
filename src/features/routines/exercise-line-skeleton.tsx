import { Skeleton, SkeletonLine } from "../../components/skeleton";

/**
 * The placeholder for an `<ExerciseLine>`: photo, name and target.
 *
 * Its own file and not next to `ExerciseLine` on purpose. That one imports
 * the catalog and is only reachable through `lazy()`; this one is shown
 * precisely while those chunks download, so it has to live outside them.
 */
export function ExerciseLineSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="aspect-3/2 w-20 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <SkeletonLine className="w-36 font-medium leading-tight" />
        <SkeletonLine className="mt-1 w-20 text-xs" />
      </div>
    </div>
  );
}
