import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router";
import type { AppConfig } from "./config";
import { useDocumentPreferences } from "./hooks/useDocumentPreferences";
import { usePreferences } from "./hooks/usePreferences";
import { AppRoutes } from "./routes/AppRoutes";
import { createServices } from "./services/createServices";
import { ServicesContext } from "./services/ServicesContext";
import type { Services } from "./services/types";

export interface AppProps {
  config: AppConfig;
  services?: Services;
  router?: (children: React.JSX.Element) => React.JSX.Element;
}

const browserRouter = (children: React.JSX.Element): React.JSX.Element => (
  /* Navigations commit at once, before the player update that follows them, so a guarded page that sends the player elsewhere is never redirected first. */
  <BrowserRouter useTransitions={false}>{children}</BrowserRouter>
);

function DocumentPreferences(): null {
  useDocumentPreferences(usePreferences().preferences);
  return null;
}

/** Application root: services, data cache, document preferences and the router. */
export function App({ config, services, router = browserRouter }: AppProps): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  const [resolved] = useState(() => services ?? createServices(config));
  return (
    <ServicesContext.Provider value={resolved}>
      <QueryClientProvider client={queryClient}>
        <DocumentPreferences />
        <div data-stage={config.stage} data-data-mode={config.dataMode}>
          {router(<AppRoutes />)}
        </div>
      </QueryClientProvider>
    </ServicesContext.Provider>
  );
}
