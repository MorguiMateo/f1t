import { QueryClient } from "@tanstack/react-query";

let activeIdentity: string | null = null;
let identityGeneration = 0;
const clientGeneration = new WeakMap<QueryClient, number>();

/** Call synchronously when auth identity changes, before React commits its new tree. */
export function setAuthQueryIdentity(userId: string | null) {
  if (activeIdentity === userId) return;
  activeIdentity = userId;
  identityGeneration++;
}

export function createAuthQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Used at the gym on bad reception: prefer cache, don't retry eagerly.
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  clientGeneration.set(client, identityGeneration);
  return client;
}

export function isAuthQueryClientActive(client: QueryClient): boolean {
  return clientGeneration.get(client) === identityGeneration;
}

export function assertAuthQueryClientActive(client: QueryClient): void {
  if (!isAuthQueryClientActive(client)) {
    throw new Error("La sesión cambió; se canceló la operación pendiente.");
  }
}

/** Check at mutationFn execution, not only at enqueue/onMutate time. */
export function guardAuthMutation<TArgs, TResult>(
  client: QueryClient,
  mutationFn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args) => {
    assertAuthQueryClientActive(client);
    return mutationFn(args);
  };
}

/** A late success/error callback may still run after its component unmounts. */
export function runIfAuthQueryClientActive<TResult>(
  client: QueryClient,
  callback: () => TResult,
): TResult | undefined {
  if (!isAuthQueryClientActive(client)) return undefined;
  return callback();
}

export function disposeAuthQueryClient(client: QueryClient) {
  // Preserve the mutation cache until queued promises settle: QueryClient.clear()
  // removes its scope queue and can leave paused mutations pending forever.
  // Late callbacks must use the active-client guard before writing query data.
  void client.cancelQueries();
  client.getQueryCache().clear();
}
