import type { ReactNode } from "react";
import { useInRouterContext, useLocation } from "react-router";
import { backFallback } from "./navigation";
import { useAppBack } from "./use-app-back";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  onBack?: () => void;
  onBeforeBack?: (proceed: () => void) => void;
  backTo?: string;
  backLabel?: string;
};

function BackArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function PageHeader(props: PageHeaderProps) {
  const routed = useInRouterContext();
  return routed ? <RoutedHeader {...props} /> : <HeaderContent {...props} />;
}

function RoutedHeader(props: PageHeaderProps) {
  const location = useLocation();
  const back = useAppBack(props.backTo, props.onBack, props.onBeforeBack);
  const showBack = props.onBack || props.onBeforeBack || props.backTo || backFallback(location.pathname + location.search);
  return <HeaderContent {...props} onBack={showBack ? back : undefined} />;
}

function HeaderContent({ title, subtitle, action, onBack, backLabel = "Volver" }: PageHeaderProps) {
  return (
    <header
      className="pb-5"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)" }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="-ml-2 mb-2 flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <BackArrow />
        </button>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
    </header>
  );
}
