import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app";
import { SessionProvider } from "./features/auth/session-provider";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Used at the gym on bad reception: prefer cache, don't retry eagerly.
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
