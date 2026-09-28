import { Skeleton, SkeletonLine } from "../../components/skeleton";

// Kept apart from `ExerciseLine`, which pulls in the catalog: this renders
// while those lazy chunks download, so it must live outside them.
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
