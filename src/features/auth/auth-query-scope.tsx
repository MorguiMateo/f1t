import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { createAuthQueryClient, disposeAuthQueryClient } from "./auth-query-client";

export function AuthQueryScope({ children }: { children: ReactNode }) {
  const [client] = useState(createAuthQueryClient);

  useEffect(() => () => disposeAuthQueryClient(client), [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
