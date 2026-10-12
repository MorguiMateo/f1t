import { useLocation, useNavigate } from "react-router";
import { backAction, backFallback, validateInternalDestination } from "./navigation";

export function useAppBack(fallback?: string, onBack?: () => void, beforeBack?: (proceed: () => void) => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const stateReturn = location.state && typeof location.state === "object"
    ? validateInternalDestination(location.state.returnTo) : null;
  return () => {
    const action = backAction(typeof window === "undefined" ? undefined : window.history?.state?.idx,
      fallback ?? stateReturn ?? backFallback(location.pathname + location.search) ?? "/");
    const proceed = () => {
      if ("delta" in action) {
        if (onBack) onBack();
        else void navigate(action.delta);
      } else void navigate(action.to, { replace: true });
    };
    // A guard receives the same safe operation for history and direct-entry
    // fallbacks. Production data-router blockers additionally protect all exits.
    if (beforeBack) beforeBack(proceed);
    else proceed();
  };
}
