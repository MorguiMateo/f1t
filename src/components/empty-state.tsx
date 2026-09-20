import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface/50 px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      <p className="max-w-[34ch] text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
