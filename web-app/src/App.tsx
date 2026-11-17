import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router";
import type { AppConfig } from "./config";
import { AppRoutes } from "./routes/AppRoutes";

export interface AppProps {
  config: AppConfig;
  router?: (children: React.JSX.Element) => React.JSX.Element;
}

const browserRouter = (children: React.JSX.Element): React.JSX.Element => (
  <BrowserRouter>{children}</BrowserRouter>
);

/** Application root: data cache and router around the route table. */
export function App({ config, router = browserRouter }: AppProps): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <div data-stage={config.stage} data-data-mode={config.dataMode}>
        {router(<AppRoutes />)}
      </div>
    </QueryClientProvider>
  );
}
